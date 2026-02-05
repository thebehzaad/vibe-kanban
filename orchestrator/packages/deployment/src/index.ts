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

import type { DbPool } from '@orchestrator/db';
import type {
  GitService,
  ContainerService,
  ConfigService,
  ProjectService
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

  /** Get database connection pool */
  db(): DbPool;

  /** Get configuration service */
  config(): ConfigService;

  /** Get git service */
  git(repoPath: string): GitService;

  /** Get container service */
  container(): ContainerService;

  /** Get project service */
  project(): ProjectService;

  /** Cleanup deployment resources */
  cleanup(): Promise<void>;
}

export type { DbPool, GitService, ContainerService, ConfigService, ProjectService };
