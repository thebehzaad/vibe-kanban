/**
 * @orchestrator/local-deployment
 *
 * Local deployment implementation.
 * TypeScript translation of crates/local-deployment.
 *
 * Implements Deployment interface for local machine execution.
 */

import type { Deployment, DbPool } from '@orchestrator/deployment';
import {
  GitService,
  ContainerService,
  ConfigService,
  ProjectService
} from '@orchestrator/services';

export interface LocalDeploymentConfig {
  dataDir: string;
  dbPath?: string;
}

export class LocalDeployment implements Deployment {
  private _db: DbPool | null = null;
  private _config: ConfigService;
  private _containerService: ContainerService | null = null;
  private _projectService: ProjectService | null = null;

  constructor(
    public readonly userId: string,
    private deploymentConfig: LocalDeploymentConfig
  ) {
    this._config = new ConfigService({
      dataDir: deploymentConfig.dataDir
    });
  }

  async initialize(): Promise<void> {
    // TODO: Initialize database connection
    // TODO: Setup local services
  }

  db(): DbPool {
    if (!this._db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this._db;
  }

  config(): ConfigService {
    return this._config;
  }

  git(repoPath: string): GitService {
    return new GitService({ repoPath });
  }

  container(): ContainerService {
    if (!this._containerService) {
      this._containerService = new ContainerService({});
    }
    return this._containerService;
  }

  project(): ProjectService {
    if (!this._projectService) {
      this._projectService = new ProjectService({});
    }
    return this._projectService;
  }

  async cleanup(): Promise<void> {
    // TODO: Cleanup resources
  }
}

export async function createLocalDeployment(
  userId: string,
  config: LocalDeploymentConfig
): Promise<LocalDeployment> {
  const deployment = new LocalDeployment(userId, config);
  await deployment.initialize();
  return deployment;
}
