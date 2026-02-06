/**
 * @orchestrator/local-deployment
 *
 * Local deployment implementation.
 * TypeScript translation of crates/local-deployment.
 *
 * Implements Deployment interface for local machine execution.
 */

import type { Deployment } from '@orchestrator/deployment';
import { DBService } from '@orchestrator/db';
import {
  GitService,
  ContainerService,
  ConfigService,
  ProjectService,
  EventsService,
  FilesystemService,
  ApprovalService,
  NotificationService,
  QueuedMessageService,
} from '@orchestrator/services';
import * as path from 'node:path';

export interface LocalDeploymentConfig {
  dataDir: string;
  dbPath?: string;
  port?: number;
  gitBranchPrefix?: string;
}

export class LocalDeployment implements Deployment {
  private _db: DBService | null = null;
  private _config: ConfigService;
  private _containerService: ContainerService | null = null;
  private _projectService: ProjectService | null = null;
  private _eventsService: EventsService | null = null;
  private _approvalService: ApprovalService | null = null;
  private _notificationService: NotificationService | null = null;
  private _queuedMessageService: QueuedMessageService | null = null;

  constructor(
    public readonly userId: string,
    private deploymentConfig: LocalDeploymentConfig
  ) {
    this._config = new ConfigService({
      dataDir: deploymentConfig.dataDir,
      port: deploymentConfig.port,
      gitBranchPrefix: deploymentConfig.gitBranchPrefix,
    });
  }

  async initialize(): Promise<void> {
    // Initialize database
    const dbPath = this.deploymentConfig.dbPath ??
      path.join(this.deploymentConfig.dataDir, 'db.sqlite');

    this._db = await DBService.create({
      dbPath,
      walMode: true,
    });

    // Clean up any orphaned processes from previous runs
    const container = this.container();
    await container.cleanupOrphanExecutions(this._db);
  }

  db(): DBService {
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
      this._containerService = new ContainerService({
        gitBranchPrefix: this._config.get('gitBranchPrefix'),
        autoCommit: this._config.get('autoCommit'),
      });
    }
    return this._containerService;
  }

  project(): ProjectService {
    if (!this._projectService) {
      this._projectService = new ProjectService({ db: this.db() });
    }
    return this._projectService;
  }

  events(): EventsService {
    if (!this._eventsService) {
      this._eventsService = new EventsService();
    }
    return this._eventsService;
  }

  filesystem(basePath: string): FilesystemService {
    return new FilesystemService(basePath);
  }

  approvals(): ApprovalService {
    if (!this._approvalService) {
      this._approvalService = new ApprovalService();
    }
    return this._approvalService;
  }

  notifications(): NotificationService {
    if (!this._notificationService) {
      this._notificationService = new NotificationService();
    }
    return this._notificationService;
  }

  queuedMessages(): QueuedMessageService {
    if (!this._queuedMessageService) {
      this._queuedMessageService = new QueuedMessageService();
    }
    return this._queuedMessageService;
  }

  async cleanup(): Promise<void> {
    // Kill all running processes
    if (this._containerService) {
      await this._containerService.killAllRunningProcesses();
    }

    // Cleanup approval service
    if (this._approvalService) {
      this._approvalService.cleanup();
    }

    // Close config watchers
    this._config.close();

    // Close database
    if (this._db) {
      this._db.close();
      this._db = null;
    }
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
