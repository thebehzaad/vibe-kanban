/**
 * Execution Processes routes
 * Translates: crates/server/src/routes/execution_processes.rs
 *
 * Rust pattern: State(deployment) → deployment.db().pool / deployment.container()
 * TS pattern:   fastify.deployment → deployment.db() → new ExecutionProcessRepository(db)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  ExecutionProcessRepository,
} from '@runner/db';
import type { Deployment } from '@runner/deployment';

// Re-export DB types for consumers
export type {
  ExecutionProcess,
  ExecutionProcessStatus as ExecutionStatus,
} from '@runner/db';

// WebSocket connections for log streaming
const rawLogSubscribers = new Map<string, Set<any>>();
const normalizedLogSubscribers = new Map<string, Set<any>>();

export const executionProcessRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new ExecutionProcessRepository(db());

  // GET /api/execution-processes/:id - Get execution process
  fastify.get<{ Params: { id: string } }>(
    '/execution-processes/:id/',
    async (request, reply) => {
      const repo = getRepo();
      const process = repo.findById(request.params.id);

      if (!process) {
        return reply.status(404).send({ error: 'Execution process not found' });
      }

      return process;
    }
  );

  // POST /api/execution-processes/:id/stop - Stop execution
  fastify.post<{ Params: { id: string } }>(
    '/execution-processes/:id/stop',
    async (request, reply) => {
      const repo = getRepo();
      const { id } = request.params;
      const process = repo.findById(id);

      if (!process) {
        return reply.status(404).send({ error: 'Execution process not found' });
      }

      if (process.status !== 'running') {
        return reply.status(400).send({ error: `Cannot stop process in ${process.status} status` });
      }

      repo.updateCompletion(id, 'killed');

      fastify.log.info(`Execution process ${id} stopped`);

      return { success: true, processId: id, status: 'killed' };
    }
  );

  // GET /api/execution-processes/:id/repo-states - Get repository states
  fastify.get<{ Params: { id: string } }>(
    '/execution-processes/:id/repo-states',
    async (request, reply) => {
      const repo = getRepo();
      const { id } = request.params;

      const process = repo.findById(id);
      if (!process) {
        return reply.status(404).send({ error: 'Execution process not found' });
      }

      // Query repo states from DB
      const states = db().prepare(`
        SELECT eprs.id, eprs.execution_process_id, eprs.repo_id,
               eprs.before_head_commit, eprs.after_head_commit, eprs.created_at,
               r.path as repo_path, r.name as repo_name
        FROM execution_process_repo_states eprs
        LEFT JOIN repos r ON eprs.repo_id = r.id
        WHERE eprs.execution_process_id = ?
      `).all(id) as Array<{
        id: string;
        execution_process_id: string;
        repo_id: string;
        before_head_commit: string | null;
        after_head_commit: string | null;
        created_at: string;
        repo_path: string | null;
        repo_name: string | null;
      }>;

      const repoStates = states.map(s => ({
        id: s.id,
        executionProcessId: s.execution_process_id,
        repoId: s.repo_id,
        beforeHeadCommit: s.before_head_commit ?? undefined,
        afterHeadCommit: s.after_head_commit ?? undefined,
        repoPath: s.repo_path ?? undefined,
        repoName: s.repo_name ?? undefined,
        createdAt: s.created_at,
      }));

      return { processId: id, repoStates };
    }
  );

  // GET /api/execution-processes/:id/raw-logs/ws - WebSocket for raw logs
  fastify.get<{ Params: { id: string } }>(
    '/execution-processes/:id/raw-logs/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const repo = getRepo();
      const { id } = request.params;

      if (!repo.findById(id)) {
        socket.close(4004, 'Execution process not found');
        return;
      }

      // Add subscriber
      if (!rawLogSubscribers.has(id)) {
        rawLogSubscribers.set(id, new Set());
      }
      rawLogSubscribers.get(id)!.add(socket);

      fastify.log.info(`Raw logs WebSocket connected for process ${id}`);

      // Send existing logs from DB
      const existingLogs = db().prepare(`
        SELECT id, execution_process_id, log_type, content, sequence, created_at
        FROM execution_process_logs
        WHERE execution_process_id = ?
        ORDER BY sequence ASC
      `).all(id) as Array<{
        id: string;
        execution_process_id: string;
        log_type: string;
        content: string;
        sequence: number;
        created_at: string;
      }>;

      for (const log of existingLogs) {
        socket.send(JSON.stringify({
          type: 'log',
          data: {
            id: log.id,
            processId: log.execution_process_id,
            timestamp: log.created_at,
            level: log.log_type,
            message: log.content,
          },
        }));
      }

      socket.on('close', () => {
        rawLogSubscribers.get(id)?.delete(socket);
        fastify.log.info(`Raw logs WebSocket disconnected for process ${id}`);
      });
    }
  );

  // GET /api/execution-processes/:id/normalized-logs/ws - WebSocket for normalized logs
  fastify.get<{ Params: { id: string } }>(
    '/execution-processes/:id/normalized-logs/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const repo = getRepo();
      const { id } = request.params;

      if (!repo.findById(id)) {
        socket.close(4004, 'Execution process not found');
        return;
      }

      // Add subscriber
      if (!normalizedLogSubscribers.has(id)) {
        normalizedLogSubscribers.set(id, new Set());
      }
      normalizedLogSubscribers.get(id)!.add(socket);

      fastify.log.info(`Normalized logs WebSocket connected for process ${id}`);

      // Send existing coding agent turns from DB
      const existingTurns = db().prepare(`
        SELECT id, execution_process_id, turn_number, prompt, response, tool_calls, created_at
        FROM coding_agent_turns
        WHERE execution_process_id = ?
        ORDER BY turn_number ASC
      `).all(id) as Array<{
        id: string;
        execution_process_id: string;
        turn_number: number;
        prompt: string | null;
        response: string | null;
        tool_calls: string | null;
        created_at: string;
      }>;

      for (const turn of existingTurns) {
        socket.send(JSON.stringify({
          type: 'normalized_log',
          data: {
            id: turn.id,
            processId: turn.execution_process_id,
            timestamp: turn.created_at,
            turnNumber: turn.turn_number,
            prompt: turn.prompt,
            response: turn.response,
            toolCalls: turn.tool_calls ? JSON.parse(turn.tool_calls) : undefined,
          },
        }));
      }

      socket.on('close', () => {
        normalizedLogSubscribers.get(id)?.delete(socket);
        fastify.log.info(`Normalized logs WebSocket disconnected for process ${id}`);
      });
    }
  );

  // GET /api/execution-processes/stream/session/ws - Stream processes by session
  fastify.get<{ Querystring: { session_id: string; show_soft_deleted?: boolean } }>(
    '/execution-processes/stream/session/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const repo = getRepo();
      const { session_id, show_soft_deleted } = request.query;

      fastify.log.info(`Process stream WebSocket connected for session ${session_id}`);

      // Send existing processes for this session from DB
      const sessionProcesses = repo.findBySessionId(session_id, !!show_soft_deleted);

      for (const process of sessionProcesses) {
        socket.send(JSON.stringify({ type: 'process', data: process }));
      }

      socket.on('close', () => {
        fastify.log.info(`Process stream WebSocket disconnected for session ${session_id}`);
      });
    }
  );
};

// Helper functions for managing execution processes (used by other route modules)
// Accept Deployment to match Rust pattern where these would go through deployment services
export function addRawLog(
  deployment: Deployment,
  processId: string,
  level: string,
  message: string,
): void {
  const dbService = deployment.db();

  // Get next sequence number
  const seqRow = dbService.prepare(
    'SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM execution_process_logs WHERE execution_process_id = ?'
  ).get(processId) as { next_seq: number };

  const id = crypto.randomUUID();
  dbService.prepare(`
    INSERT INTO execution_process_logs (id, execution_process_id, log_type, content, sequence, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(id, processId, level, message, seqRow.next_seq);

  // Broadcast to WebSocket subscribers
  const subscribers = rawLogSubscribers.get(processId);
  if (subscribers) {
    const data = JSON.stringify({
      type: 'log',
      data: { id, processId, timestamp: new Date().toISOString(), level, message },
    });
    for (const socket of subscribers) {
      try {
        socket.send(data);
      } catch {
        subscribers.delete(socket);
      }
    }
  }
}

export function addNormalizedLog(
  _deployment: Deployment,
  processId: string,
  type: string,
  content: unknown
): void {
  // Broadcast to WebSocket subscribers
  const subscribers = normalizedLogSubscribers.get(processId);
  if (subscribers) {
    const data = JSON.stringify({
      type: 'normalized_log',
      data: {
        id: crypto.randomUUID(),
        processId,
        timestamp: new Date().toISOString(),
        type,
        content,
      },
    });
    for (const socket of subscribers) {
      try {
        socket.send(data);
      } catch {
        subscribers.delete(socket);
      }
    }
  }
}
