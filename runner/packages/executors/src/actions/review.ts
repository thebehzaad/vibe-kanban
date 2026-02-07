/**
 * Code Review Request action
 * Translates: crates/executors/src/actions/review.rs
 */

import * as path from 'node:path';
import type { ExecutorApprovalService } from '../approvals.js';
import type { ExecutionEnv } from '../env.js';
import type { BaseCodingAgent, SpawnedChild } from '../executors/index.js';
import type { ExecutorProfileId } from '../profile.js';
import type { Executable } from './index.js';

export interface RepoReviewContext {
  repoId: string;
  repoName: string;
  baseCommit: string;
}

export class ReviewRequest implements Executable {
  public readonly executorProfileId: ExecutorProfileId;
  public readonly context?: RepoReviewContext[];
  public readonly prompt: string;
  public readonly sessionId?: string;
  public readonly workingDir?: string;

  constructor(params: {
    executorProfileId: ExecutorProfileId;
    context?: RepoReviewContext[];
    prompt: string;
    sessionId?: string;
    workingDir?: string;
  }) {
    this.executorProfileId = params.executorProfileId;
    this.context = params.context;
    this.prompt = params.prompt;
    this.sessionId = params.sessionId;
    this.workingDir = params.workingDir;
  }

  baseExecutor(): BaseCodingAgent {
    return this.executorProfileId.executor;
  }

  effectiveDir(currentDir: string): string {
    if (this.workingDir) {
      return path.join(currentDir, this.workingDir);
    }
    return currentDir;
  }

  async spawn(
    currentDir: string,
    _approvals: ExecutorApprovalService,
    _env: ExecutionEnv,
  ): Promise<SpawnedChild> {
    const _effectiveDir = this.effectiveDir(currentDir);
    // TODO: Resolve executor from ExecutorConfigs and spawn review
    throw new Error('ReviewRequest.spawn not yet implemented');
  }
}
