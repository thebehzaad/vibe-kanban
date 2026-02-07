/**
 * Coding Agent Initial Request action
 * Translates: crates/executors/src/actions/coding_agent_initial.rs
 */

import type { BaseExecutor } from '../base.js';
import type { ExecutionRequest, SpawnedChild, ExecutionEnv } from '../types.js';
import { MsgStore } from '@runner/utils';

export interface InitialRequestParams {
  prompt: string;
  executionEnv: ExecutionEnv;
  executor: BaseExecutor;
}

/** Create and spawn an initial coding agent request */
export async function executeInitialRequest(params: InitialRequestParams): Promise<{ spawned: SpawnedChild | undefined; msgStore: MsgStore }> {
  const msgStore = new MsgStore(crypto.randomUUID());
  const request: ExecutionRequest = {
    prompt: params.prompt,
    workingDir: params.executionEnv.workingDir,
    env: params.executionEnv.env,
  };

  // Use spawn if available on the executor, otherwise execute
  const spawned = 'spawn' in params.executor
    ? await (params.executor as any).spawn(request, msgStore)
    : undefined;

  return { spawned, msgStore };
}
