/**
 * @orchestrator/deployment
 *
 * Deployment abstraction interface.
 * TypeScript translation of crates/deployment.
 *
 * Defines the contract that deployment implementations must follow.
 * Implementations:
 * - LocalDeployment (@orchestrator/local-deployment)
 * - RemoteDeployment (@orchestrator/remote)
 */

import type { DBService } from '@orchestrator/db';
import type {
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

export interface DeploymentError {
  code: string;
  message: string;
  cause?: Error;
}

/**
 * Deployment interface - equivalent to Rust trait
 * All deployment implementations must satisfy this interface
 */
export interface Deployment {
  /** Unique identifier for the deployment */
  readonly userId: string;

  /** Initialize the deployment */
  initialize(): Promise<void>;

  /** Get database service */
  db(): DBService;

  /** Get configuration service */
  config(): ConfigService;

  /** Get git service for a repo */
  git(repoPath: string): GitService;

  /** Get container service */
  container(): ContainerService;

  /** Get project service */
  project(): ProjectService;

  /** Get events service */
  events(): EventsService;

  /** Get filesystem service */
  filesystem(basePath: string): FilesystemService;

  /** Get approval service */
  approvals(): ApprovalService;

  /** Get notification service */
  notifications(): NotificationService;

  /** Get queued message service */
  queuedMessages(): QueuedMessageService;

  /** Cleanup deployment resources */
  cleanup(): Promise<void>;
}

// Re-export types for convenience
export type {
  DBService as DbPool,
  GitService,
  ContainerService,
  ConfigService,
  ProjectService,
  EventsService,
  FilesystemService,
  ApprovalService,
  NotificationService,
  QueuedMessageService,
};
