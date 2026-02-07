/**
 * Coding Agent Follow-up Request action
 * Translates: crates/executors/src/actions/coding_agent_follow_up.rs
 */

import type { BaseExecutor } from '../base.js';
import type { ExecutionRequest, SpawnedChild, ExecutionEnv } from '../types.js';
import { MsgStore } from '@runner/utils';

export interface FollowUpRequestParams {
  prompt: string;
  executionEnv: ExecutionEnv;
  executor: BaseExecutor;
  /** Session ID for session resumption */
  sessionId: string;
  /** Optional message UUID to continue from a specific message */
  messageUuid?: string;
}

/** Create and spawn a follow-up coding agent request with session resumption */
export async function executeFollowUpRequest(params: FollowUpRequestParams): Promise<{ spawned: SpawnedChild | undefined; msgStore: MsgStore }> {
  const msgStore = new MsgStore(crypto.randomUUID());
  const request: ExecutionRequest = {
    prompt: params.prompt,
    workingDir: params.executionEnv.workingDir,
    env: params.executionEnv.env,
  };

  // Use spawnFollowUp if available on the executor for session resumption
  let spawned: SpawnedChild | undefined;

  if ('spawnFollowUp' in params.executor) {
    spawned = await (params.executor as any).spawnFollowUp(
      request,
      params.sessionId,
      msgStore,
      params.messageUuid,
    );
  } else if ('spawn' in params.executor) {
    // Fallback: inject session info into the request options
    const requestWithSession: ExecutionRequest = {
      ...request,
      options: {
        ...request.options,
        sessionId: params.sessionId,
        messageUuid: params.messageUuid,
      },
    };
    spawned = await (params.executor as any).spawn(requestWithSession, msgStore);
  }

  return { spawned, msgStore };
}
