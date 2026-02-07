/**
 * Configuration service - Full implementation
 * Translates: crates/services/src/config/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface runnerConfig {
  dataDir: string;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  gitBranchPrefix: string;
  autoCommit: boolean;
  defaultExecutor: string;
  maxConcurrentExecutions: number;
}

const DEFAULT_CONFIG: runnerConfig = {
  dataDir: './data',
  port: 3000,
  logLevel: 'info',
  gitBranchPrefix: 'vk',
  autoCommit: true,
  defaultExecutor: 'claude',
  maxConcurrentExecutions: 5,
};

export class ConfigService {
  private config: runnerConfig;
  private configPath: string | undefined;
  private watchers: Map<string, fs.FSWatcher> = new Map();

  constructor(initialConfig: Partial<runnerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...initialConfig };
  }

  get<K extends keyof runnerConfig>(key: K): runnerConfig[K] {
    return this.config[key];
  }

  set<K extends keyof runnerConfig>(key: K, value: runnerConfig[K]): void {
    this.config[key] = value;
  }

  getAll(): runnerConfig {
    return { ...this.config };
  }

  /** Merge partial config into current config */
  merge(partial: Partial<runnerConfig>): void {
    Object.assign(this.config, partial);
  }

  /** Validate the current configuration */
  validate(): string[] {
    const errors: string[] = [];

    if (!this.config.dataDir) {
      errors.push('dataDir is required');
    }
    if (this.config.port < 1 || this.config.port > 65535) {
      errors.push('port must be between 1 and 65535');
    }
    if (this.config.maxConcurrentExecutions < 1) {
      errors.push('maxConcurrentExecutions must be at least 1');
    }

    return errors;
  }

  // ─── File Persistence ─────────────────────────────────────────────

  /** Load configuration from a JSON file */
  loadFromFile(configPath: string): void {
    this.configPath = configPath;
    if (!fs.existsSync(configPath)) return;

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(content) as Partial<runnerConfig>;
      this.merge(fileConfig);
    } catch (err) {
      console.error(`Failed to load config from ${configPath}:`, err);
    }
  }

  /** Save current configuration to file */
  saveToFile(configPath?: string): void {
    const targetPath = configPath ?? this.configPath;
    if (!targetPath) {
      throw new Error('No config file path specified');
    }

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(targetPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /** Watch for config file changes and auto-reload */
  watchChanges(configPath?: string): () => void {
    const targetPath = configPath ?? this.configPath;
    if (!targetPath) {
      throw new Error('No config file path specified');
    }

    const watcher = fs.watch(targetPath, () => {
      try {
        this.loadFromFile(targetPath);
      } catch {
        // Ignore reload errors
      }
    });

    this.watchers.set(targetPath, watcher);
    return () => {
      watcher.close();
      this.watchers.delete(targetPath);
    };
  }

  // ─── Scoped Config ────────────────────────────────────────────────

  /** Get user-specific config (from ~/.vibe-kanban/config.json) */
  getUserConfigPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.vibe-kanban', 'config.json');
  }

  /** Get workspace-specific config (from .vibe-kanban/config.json in project root) */
  getWorkspaceConfigPath(projectRoot: string): string {
    return path.join(projectRoot, '.vibe-kanban', 'config.json');
  }

  /** Cleanup watchers */
  close(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
