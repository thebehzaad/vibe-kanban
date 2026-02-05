/**
 * Terminal routes (WebSocket PTY)
 * Translates: crates/server/src/routes/terminal.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as pty from 'node-pty';
import * as os from 'node:os';

// Types
export interface TerminalSession {
  id: string;
  workspaceId: string;
  pty: pty.IPty;
  cols: number;
  rows: number;
  createdAt: Date;
}

export interface TerminalOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

// Active terminal sessions
const terminals = new Map<string, TerminalSession>();

// Get default shell
function getDefaultShell(): string {
  if (os.platform() === 'win32') {
    return process.env['COMSPEC'] ?? 'cmd.exe';
  }
  return process.env['SHELL'] ?? '/bin/bash';
}

export const terminalRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/terminal/ws - WebSocket for terminal
  fastify.get<{
    Querystring: {
      workspace_id: string;
      cols?: number;
      rows?: number;
      cwd?: string;
    };
  }>(
    '/terminal/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const {
        workspace_id,
        cols = 80,
        rows = 24,
        cwd
      } = request.query;

      const sessionId = crypto.randomUUID();
      const shell = getDefaultShell();
      const workingDir = cwd ?? process.cwd();

      fastify.log.info(`Terminal session starting: ${sessionId} for workspace ${workspace_id}`);
      fastify.log.info(`Shell: ${shell}, CWD: ${workingDir}, Size: ${cols}x${rows}`);

      let ptyProcess: pty.IPty;

      try {
        // Create PTY process
        ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: workingDir,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            VK_SESSION_ID: sessionId,
            VK_WORKSPACE_ID: workspace_id
          } as Record<string, string>
        });

        // Store session
        const session: TerminalSession = {
          id: sessionId,
          workspaceId: workspace_id,
          pty: ptyProcess,
          cols,
          rows,
          createdAt: new Date()
        };
        terminals.set(sessionId, session);

        // Send session info
        socket.send(JSON.stringify({
          type: 'session',
          sessionId,
          shell,
          cwd: workingDir
        }));

        // Forward PTY output to WebSocket
        ptyProcess.onData((data: string) => {
          try {
            socket.send(JSON.stringify({
              type: 'output',
              data
            }));
          } catch {
            // Socket closed
          }
        });

        // Handle PTY exit
        ptyProcess.onExit(({ exitCode, signal }) => {
          fastify.log.info(`Terminal ${sessionId} exited: code=${exitCode}, signal=${signal}`);
          try {
            socket.send(JSON.stringify({
              type: 'exit',
              exitCode,
              signal
            }));
            socket.close();
          } catch {
            // Socket already closed
          }
          terminals.delete(sessionId);
        });

        // Handle WebSocket messages
        socket.on('message', (message: Buffer) => {
          try {
            const data = JSON.parse(message.toString());

            switch (data.type) {
              case 'input':
                // User input
                ptyProcess.write(data.data);
                break;

              case 'resize':
                // Terminal resize
                if (data.cols && data.rows) {
                  ptyProcess.resize(data.cols, data.rows);
                  session.cols = data.cols;
                  session.rows = data.rows;
                }
                break;

              case 'ping':
                // Keep-alive ping
                socket.send(JSON.stringify({ type: 'pong' }));
                break;

              default:
                fastify.log.warn(`Unknown terminal message type: ${data.type}`);
            }
          } catch (err) {
            fastify.log.error({ err }, 'Error processing terminal message');
          }
        });

        // Handle WebSocket close
        socket.on('close', () => {
          fastify.log.info(`Terminal WebSocket closed: ${sessionId}`);

          // Kill PTY process
          try {
            ptyProcess.kill();
          } catch {
            // Already dead
          }

          terminals.delete(sessionId);
        });

        // Handle WebSocket error
        socket.on('error', (err: Error) => {
          fastify.log.error(`Terminal WebSocket error: ${err.message}`);
        });

      } catch (err) {
        fastify.log.error({ err }, 'Failed to create terminal');
        socket.send(JSON.stringify({
          type: 'error',
          message: 'Failed to create terminal session'
        }));
        socket.close();
      }
    }
  );

  // GET /api/terminal/sessions - List active terminals (internal)
  fastify.get('/terminal/sessions', async () => {
    const sessions = Array.from(terminals.values()).map(s => ({
      id: s.id,
      workspaceId: s.workspaceId,
      cols: s.cols,
      rows: s.rows,
      createdAt: s.createdAt.toISOString()
    }));

    return { sessions, total: sessions.length };
  });

  // DELETE /api/terminal/sessions/:id - Kill terminal session (internal)
  fastify.delete<{ Params: { id: string } }>(
    '/terminal/sessions/:id',
    async (request, reply) => {
      const { id } = request.params;
      const session = terminals.get(id);

      if (!session) {
        return reply.status(404).send({ error: 'Terminal session not found' });
      }

      try {
        session.pty.kill();
      } catch {
        // Already dead
      }

      terminals.delete(id);

      return { success: true, sessionId: id };
    }
  );
};

// Export helpers
export function getTerminalSession(sessionId: string): TerminalSession | undefined {
  return terminals.get(sessionId);
}

export function killTerminalSession(sessionId: string): boolean {
  const session = terminals.get(sessionId);
  if (!session) return false;

  try {
    session.pty.kill();
  } catch {
    // Already dead
  }

  terminals.delete(sessionId);
  return true;
}

export function killWorkspaceTerminals(workspaceId: string): number {
  let killed = 0;

  for (const [sessionId, session] of terminals) {
    if (session.workspaceId === workspaceId) {
      try {
        session.pty.kill();
      } catch {
        // Already dead
      }
      terminals.delete(sessionId);
      killed++;
    }
  }

  return killed;
}
