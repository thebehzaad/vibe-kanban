/**
 * Coding Agent Follow-up Request action
 * Translates: crates/executors/src/actions/coding_agent_follow_up.rs
 */

import * as path from 'node:path';
import type { ExecutorApprovalService } from '../approvals.js';
import type { ExecutionEnv } from '../env.js';
import type { BaseCodingAgent, SpawnedChild } from '../executors/index.js';
import type { ExecutorProfileId } from '../profile.js';
import type { Executable } from './index.js';

export class CodingAgentFollowUpRequest implements Executable {
  public readonly prompt: string;
  public readonly sessionId: string;
  public readonly resetToMessageId?: string;
  public readonly executorProfileId: ExecutorProfileId;
  public readonly workingDir?: string;

  constructor(params: {
    prompt: string;
    sessionId: string;
    resetToMessageId?: string;
    executorProfileId: ExecutorProfileId;
    workingDir?: string;
  }) {
    this.prompt = params.prompt;
    this.sessionId = params.sessionId;
    this.resetToMessageId = params.resetToMessageId;
    this.executorProfileId = params.executorProfileId;
    this.workingDir = params.workingDir;
  }

  getExecutorProfileId(): ExecutorProfileId {
    return this.executorProfileId;
  }

  effectiveDir(currentDir: string): string {
    if (this.workingDir) {
      return path.join(currentDir, this.workingDir);
    }
    return currentDir;
  }

  baseExecutor(): BaseCodingAgent {
    return this.executorProfileId.executor;
  }

  async spawn(
    currentDir: string,
    _approvals: ExecutorApprovalService,
    _env: ExecutionEnv,
  ): Promise<SpawnedChild> {
    const _effectiveDir = this.effectiveDir(currentDir);
    // TODO: Resolve executor from ExecutorConfigs and spawn follow-up
    throw new Error('CodingAgentFollowUpRequest.spawn not yet implemented');
  }
}
