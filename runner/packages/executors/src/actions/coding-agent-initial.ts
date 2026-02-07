/**
 * Coding Agent Initial Request action
 * Translates: crates/executors/src/actions/coding_agent_initial.rs
 */

import * as path from 'node:path';
import type { ExecutorApprovalService } from '../approvals.js';
import type { ExecutionEnv } from '../env.js';
import type { BaseCodingAgent, SpawnedChild } from '../executors/index.js';
import type { ExecutorProfileId } from '../profile.js';
import type { Executable } from './index.js';

export class CodingAgentInitialRequest implements Executable {
  public readonly prompt: string;
  public readonly executorProfileId: ExecutorProfileId;
  public readonly workingDir?: string;

  constructor(params: {
    prompt: string;
    executorProfileId: ExecutorProfileId;
    workingDir?: string;
  }) {
    this.prompt = params.prompt;
    this.executorProfileId = params.executorProfileId;
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
    // TODO: Resolve executor from ExecutorConfigs and spawn
    throw new Error('CodingAgentInitialRequest.spawn not yet implemented');
  }
}
