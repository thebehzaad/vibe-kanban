/**
 * Execution Processes routes
 * Translates: crates/server/src/routes/execution_processes.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { emitEvent } from './events.js';

// Types
export interface ExecutionProcess {
  id: string;
  sessionId: string;
  workspaceId: string;
  executorType: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  metadata: Record<string, unknown>;
}

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExecutionLog {
  id: string;
  processId: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
}

export interface NormalizedLog {
  id: string;
  processId: string;
  timestamp: string;
  type: NormalizedLogType;
  content: unknown;
}

export type NormalizedLogType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'file_edit'
  | 'file_create'
  | 'command_execution'
  | 'command_output'
  | 'approval_request'
  | 'approval_response'
  | 'error'
  | 'status_change';

export interface RepoState {
  repoId: string;
  repoPath: string;
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
}

// In-memory stores
const processes = new Map<string, ExecutionProcess>();
const processLogs = new Map<string, ExecutionLog[]>();
const normalizedLogs = new Map<string, NormalizedLog[]>();
const repoStates = new Map<string, RepoState[]>();

// WebSocket connections for log streaming
const rawLogSubscribers = new Map<string, Set<any>>();
const normalizedLogSubscribers = new Map<string, Set<any>>();

export const executionProcessRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/execution-processes/:id - Get execution process
  fastify.get<{ Params: { id: string } }>(
    '/execution-processes/:id/',
    async (request, reply) => {
      const { id } = request.params;
      const process = processes.get(id);

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
      const { id } = request.params;
      const process = processes.get(id);

      if (!process) {
        return reply.status(404).send({ error: 'Execution process not found' });
      }

      if (process.status !== 'running' && process.status !== 'waiting_approval') {
        return reply.status(400).send({ error: `Cannot stop process in ${process.status} status` });
      }

      process.status = 'cancelled';
      process.completedAt = new Date().toISOString();
      processes.set(id, process);

      // Emit event
      emitEvent('execution.failed', {
        processId: id,
        reason: 'cancelled',
        sessionId: process.sessionId
      });

      fastify.log.info(`Execution process ${id} stopped`);

      return { success: true, processId: id, status: 'cancelled' };
    }
  );

  // GET /api/execution-processes/:id/repo-states - Get repository states
  fastify.get<{ Params: { id: string } }>(
    '/execution-processes/:id/repo-states',
    async (request, reply) => {
      const { id } = request.params;

      if (!processes.has(id)) {
        return reply.status(404).send({ error: 'Execution process not found' });
      }

      const states = repoStates.get(id) ?? [];

      return { processId: id, repoStates: states };
    }
  );

  // GET /api/execution-processes/:id/raw-logs/ws - WebSocket for raw logs
  fastify.get<{ Params: { id: string } }>(
    '/execution-processes/:id/raw-logs/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const { id } = request.params;

      if (!processes.has(id)) {
        socket.close(4004, 'Execution process not found');
        return;
      }

      // Add subscriber
      if (!rawLogSubscribers.has(id)) {
        rawLogSubscribers.set(id, new Set());
      }
      rawLogSubscribers.get(id)!.add(socket);

      fastify.log.info(`Raw logs WebSocket connected for process ${id}`);

      // Send existing logs
      const existingLogs = processLogs.get(id) ?? [];
      for (const log of existingLogs) {
        socket.send(JSON.stringify({ type: 'log', data: log }));
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
      const { id } = request.params;

      if (!processes.has(id)) {
        socket.close(4004, 'Execution process not found');
        return;
      }

      // Add subscriber
      if (!normalizedLogSubscribers.has(id)) {
        normalizedLogSubscribers.set(id, new Set());
      }
      normalizedLogSubscribers.get(id)!.add(socket);

      fastify.log.info(`Normalized logs WebSocket connected for process ${id}`);

      // Send existing normalized logs
      const existingLogs = normalizedLogs.get(id) ?? [];
      for (const log of existingLogs) {
        socket.send(JSON.stringify({ type: 'normalized_log', data: log }));
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
      const { session_id, show_soft_deleted } = request.query;

      fastify.log.info(`Process stream WebSocket connected for session ${session_id}`);

      // Send existing processes for this session
      const sessionProcesses = Array.from(processes.values())
        .filter(p => p.sessionId === session_id);

      for (const process of sessionProcesses) {
        socket.send(JSON.stringify({ type: 'process', data: process }));
      }

      // TODO: Subscribe to process updates for this session

      socket.on('close', () => {
        fastify.log.info(`Process stream WebSocket disconnected for session ${session_id}`);
      });
    }
  );
};

// Helper functions for managing execution processes
export function createExecutionProcess(
  sessionId: string,
  workspaceId: string,
  executorType: string,
  metadata: Record<string, unknown> = {}
): ExecutionProcess {
  const id = crypto.randomUUID();
  const process: ExecutionProcess = {
    id,
    sessionId,
    workspaceId,
    executorType,
    status: 'pending',
    startedAt: new Date().toISOString(),
    metadata
  };

  processes.set(id, process);
  processLogs.set(id, []);
  normalizedLogs.set(id, []);

  emitEvent('execution.started', { processId: id, sessionId, workspaceId });

  return process;
}

export function updateProcessStatus(processId: string, status: ExecutionStatus, error?: string): void {
  const process = processes.get(processId);
  if (!process) return;

  process.status = status;
  if (error) process.error = error;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    process.completedAt = new Date().toISOString();
  }

  processes.set(processId, process);

  if (status === 'completed') {
    emitEvent('execution.completed', { processId, sessionId: process.sessionId });
  } else if (status === 'failed') {
    emitEvent('execution.failed', { processId, error, sessionId: process.sessionId });
  }
}

export function addRawLog(processId: string, level: ExecutionLog['level'], message: string, source?: string): void {
  const logs = processLogs.get(processId);
  if (!logs) return;

  const log: ExecutionLog = {
    id: crypto.randomUUID(),
    processId,
    timestamp: new Date().toISOString(),
    level,
    message,
    source
  };

  logs.push(log);

  // Broadcast to subscribers
  const subscribers = rawLogSubscribers.get(processId);
  if (subscribers) {
    const data = JSON.stringify({ type: 'log', data: log });
    for (const socket of subscribers) {
      try {
        socket.send(data);
      } catch {
        subscribers.delete(socket);
      }
    }
  }

  emitEvent('execution.log', { processId, log });
}

export function addNormalizedLog(processId: string, type: NormalizedLogType, content: unknown): void {
  const logs = normalizedLogs.get(processId);
  if (!logs) return;

  const log: NormalizedLog = {
    id: crypto.randomUUID(),
    processId,
    timestamp: new Date().toISOString(),
    type,
    content
  };

  logs.push(log);

  // Broadcast to subscribers
  const subscribers = normalizedLogSubscribers.get(processId);
  if (subscribers) {
    const data = JSON.stringify({ type: 'normalized_log', data: log });
    for (const socket of subscribers) {
      try {
        socket.send(data);
      } catch {
        subscribers.delete(socket);
      }
    }
  }
}

export function setRepoStates(processId: string, states: RepoState[]): void {
  repoStates.set(processId, states);
}

export function getProcess(processId: string): ExecutionProcess | undefined {
  return processes.get(processId);
}
