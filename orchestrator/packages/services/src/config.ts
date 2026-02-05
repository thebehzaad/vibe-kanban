/**
 * Configuration service
 * Translates: crates/services/src/config/
 */

export interface OrchestratorConfig {
  dataDir: string;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class ConfigService {
  private config: OrchestratorConfig;

  constructor(initialConfig: Partial<OrchestratorConfig> = {}) {
    this.config = {
      dataDir: initialConfig.dataDir ?? './data',
      port: initialConfig.port ?? 3000,
      logLevel: initialConfig.logLevel ?? 'info'
    };
  }

  get<K extends keyof OrchestratorConfig>(key: K): OrchestratorConfig[K] {
    return this.config[key];
  }

  set<K extends keyof OrchestratorConfig>(
    key: K,
    value: OrchestratorConfig[K]
  ): void {
    this.config[key] = value;
  }

  getAll(): OrchestratorConfig {
    return { ...this.config };
  }

  // TODO: Implement config versioning, persistence, etc.
}
