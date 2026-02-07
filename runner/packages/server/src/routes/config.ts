/**
 * Configuration routes
 * Translates: crates/server/src/routes/config.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Types
export interface SystemInfo {
  version: string;
  environment: 'development' | 'production';
  loginStatus: LoginStatus;
  profiles: ExecutorProfile[];
  capabilities: Capabilities;
  config: AppConfig;
}

export interface LoginStatus {
  loggedIn: boolean;
  userId?: string;
  email?: string;
}

export interface ExecutorProfile {
  id: string;
  name: string;
  executorType: string;
  model?: string;
  isDefault: boolean;
}

export interface Capabilities {
  hasDocker: boolean;
  hasGit: boolean;
  hasGhCli: boolean;
  editors: string[];
  agents: string[];
}

export interface AppConfig {
  dataDir: string;
  defaultEditor?: string;
  defaultAgent?: string;
  theme?: 'light' | 'dark' | 'system';
  notifications?: boolean;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface UpdateConfigBody {
  defaultEditor?: string;
  defaultAgent?: string;
  theme?: 'light' | 'dark' | 'system';
  notifications?: boolean;
}

// In-memory state (replace with actual config service)
let appConfig: AppConfig = {
  dataDir: process.env['runner_DATA_DIR'] ?? './data',
  defaultEditor: 'vscode',
  defaultAgent: 'claude',
  theme: 'system',
  notifications: true
};

const profiles: ExecutorProfile[] = [
  { id: 'claude-default', name: 'Claude Default', executorType: 'claude', model: 'claude-3-opus', isDefault: true },
  { id: 'claude-sonnet', name: 'Claude Sonnet', executorType: 'claude', model: 'claude-3-sonnet', isDefault: false },
  { id: 'cursor-default', name: 'Cursor Default', executorType: 'cursor', isDefault: false },
  { id: 'codex-default', name: 'Codex Default', executorType: 'codex', model: 'gpt-4', isDefault: false }
];

const mcpConfigs = new Map<string, McpServerConfig[]>();

export const configRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/info - Get system info
  fastify.get('/info', async () => {
    const capabilities = await detectCapabilities();

    const info: SystemInfo = {
      version: process.env['npm_package_version'] ?? '0.0.1',
      environment: process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
      loginStatus: {
        loggedIn: false // TODO: Check actual login status
      },
      profiles,
      capabilities,
      config: appConfig
    };

    return info;
  });

  // PUT /api/config - Update configuration
  fastify.put<{ Body: UpdateConfigBody }>('/config', async (request) => {
    const updates = request.body;

    appConfig = {
      ...appConfig,
      ...updates
    };

    // TODO: Persist config to disk

    return { success: true, config: appConfig };
  });

  // GET /api/sounds/:sound - Serve notification sound
  fastify.get<{ Params: { sound: string } }>('/sounds/:sound', async (request, reply) => {
    const { sound } = request.params;
    const soundsDir = path.join(appConfig.dataDir, 'sounds');
    const soundPath = path.join(soundsDir, `${sound}.mp3`);

    try {
      const buffer = await fs.readFile(soundPath);
      return reply
        .header('Content-Type', 'audio/mpeg')
        .send(buffer);
    } catch {
      return reply.status(404).send({ error: 'Sound not found' });
    }
  });

  // GET /api/mcp-config - Get MCP servers configuration
  fastify.get<{ Querystring: { executor: string } }>('/mcp-config', async (request) => {
    const { executor } = request.query;
    const servers = mcpConfigs.get(executor) ?? [];

    return { executor, servers };
  });

  // POST /api/mcp-config - Update MCP servers configuration
  fastify.post<{ Querystring: { executor: string }; Body: { servers: McpServerConfig[] } }>(
    '/mcp-config',
    async (request) => {
      const { executor } = request.query;
      const { servers } = request.body;

      mcpConfigs.set(executor, servers);

      // TODO: Persist to disk

      return { success: true, executor, servers };
    }
  );

  // GET /api/profiles - Get executor profiles
  fastify.get('/profiles', async () => {
    return { profiles };
  });

  // PUT /api/profiles - Update executor profiles
  fastify.put<{ Body: { profiles: ExecutorProfile[] } }>('/profiles', async (request) => {
    const { profiles: newProfiles } = request.body;

    // Validate: exactly one default per executor type
    const defaultsByType = new Map<string, number>();
    for (const profile of newProfiles) {
      if (profile.isDefault) {
        const count = defaultsByType.get(profile.executorType) ?? 0;
        defaultsByType.set(profile.executorType, count + 1);
      }
    }

    for (const [type, count] of defaultsByType) {
      if (count > 1) {
        return { error: `Multiple defaults for executor type: ${type}` };
      }
    }

    profiles.length = 0;
    profiles.push(...newProfiles);

    // TODO: Persist to disk

    return { success: true, profiles };
  });

  // GET /api/editors/check-availability - Check editor availability
  fastify.get<{ Querystring: { editor_type: string } }>(
    '/editors/check-availability',
    async (request) => {
      const { editor_type } = request.query;
      const available = await checkEditorAvailability(editor_type);

      return { editor_type, available };
    }
  );

  // GET /api/agents/check-availability - Check agent availability
  fastify.get<{ Querystring: { executor: string } }>(
    '/agents/check-availability',
    async (request) => {
      const { executor } = request.query;
      const available = await checkAgentAvailability(executor);

      return { executor, available };
    }
  );

  // GET /api/agents/slash-commands/ws - WebSocket for slash commands
  // Note: WebSocket routes need @fastify/websocket plugin
  fastify.get<{ Querystring: { executor: string; workspace_id: string; repo_id?: string } }>(
    '/agents/slash-commands/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const { executor, workspace_id, repo_id } = request.query;

      fastify.log.info(`Slash commands WebSocket connected: executor=${executor}, workspace=${workspace_id}`);

      // TODO: Stream slash commands from executor
      socket.on('message', (message: Buffer) => {
        const data = JSON.parse(message.toString());
        fastify.log.info(`Received slash command: ${data.command}`);

        // Echo back for now
        socket.send(JSON.stringify({
          type: 'command_received',
          command: data.command,
          workspace_id,
          repo_id
        }));
      });

      socket.on('close', () => {
        fastify.log.info(`Slash commands WebSocket closed: workspace=${workspace_id}`);
      });
    }
  );
};

// Helper functions
async function detectCapabilities(): Promise<Capabilities> {
  const capabilities: Capabilities = {
    hasDocker: false,
    hasGit: false,
    hasGhCli: false,
    editors: [],
    agents: ['claude', 'cursor', 'codex', 'gemini']
  };

  // Check Docker
  try {
    const { execSync } = await import('node:child_process');
    execSync('docker --version', { stdio: 'ignore' });
    capabilities.hasDocker = true;
  } catch {
    // Docker not available
  }

  // Check Git
  try {
    const { execSync } = await import('node:child_process');
    execSync('git --version', { stdio: 'ignore' });
    capabilities.hasGit = true;
  } catch {
    // Git not available
  }

  // Check GitHub CLI
  try {
    const { execSync } = await import('node:child_process');
    execSync('gh --version', { stdio: 'ignore' });
    capabilities.hasGhCli = true;
  } catch {
    // gh CLI not available
  }

  // Detect editors
  const editorChecks = [
    { name: 'vscode', command: 'code --version' },
    { name: 'cursor', command: 'cursor --version' },
    { name: 'zed', command: 'zed --version' },
    { name: 'windsurf', command: 'windsurf --version' }
  ];

  for (const editor of editorChecks) {
    try {
      const { execSync } = await import('node:child_process');
      execSync(editor.command, { stdio: 'ignore' });
      capabilities.editors.push(editor.name);
    } catch {
      // Editor not available
    }
  }

  return capabilities;
}

async function checkEditorAvailability(editorType: string): Promise<boolean> {
  const commands: Record<string, string> = {
    vscode: 'code --version',
    'vscode-insiders': 'code-insiders --version',
    cursor: 'cursor --version',
    zed: 'zed --version',
    windsurf: 'windsurf --version',
    intellij: 'idea --version',
    xcode: 'xcodebuild -version'
  };

  const command = commands[editorType];
  if (!command) return false;

  try {
    const { execSync } = await import('node:child_process');
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function checkAgentAvailability(executor: string): Promise<boolean> {
  // For now, assume all agents are available if configured
  // TODO: Actually check API keys, CLI tools, etc.
  const availableAgents = ['claude', 'cursor', 'codex', 'gemini', 'copilot', 'qwen'];
  return availableAgents.includes(executor);
}
