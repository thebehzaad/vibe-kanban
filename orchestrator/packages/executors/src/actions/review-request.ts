/**
 * Code Review Request action
 * Translates: crates/executors/src/actions/review.rs
 */

import type { BaseExecutor } from '../base.js';
import type { ExecutionRequest, SpawnedChild, ExecutionEnv } from '../types.js';
import { MsgStore } from '@orchestrator/utils';

export interface ReviewRequestParams {
  /** The diff or changes to review */
  diff: string;
  /** Optional additional context or instructions for the review */
  instructions?: string;
  /** The execution environment */
  executionEnv: ExecutionEnv;
  /** The executor to use for the review */
  executor: BaseExecutor;
}

/** Build a review-specific prompt from the diff and optional instructions */
function buildReviewPrompt(diff: string, instructions?: string): string {
  const parts: string[] = [];

  parts.push('Please review the following code changes and provide feedback.');
  parts.push('Focus on:');
  parts.push('- Correctness and potential bugs');
  parts.push('- Code quality and maintainability');
  parts.push('- Performance considerations');
  parts.push('- Security concerns');
  parts.push('- Adherence to best practices');
  parts.push('');

  if (instructions) {
    parts.push('Additional review instructions:');
    parts.push(instructions);
    parts.push('');
  }

  parts.push('Changes to review:');
  parts.push('```diff');
  parts.push(diff);
  parts.push('```');

  return parts.join('\n');
}

/** Create and spawn a code review request */
export async function executeReviewRequest(params: ReviewRequestParams): Promise<{ spawned: SpawnedChild | undefined; msgStore: MsgStore }> {
  const msgStore = new MsgStore(crypto.randomUUID());
  const prompt = buildReviewPrompt(params.diff, params.instructions);

  const request: ExecutionRequest = {
    prompt,
    workingDir: params.executionEnv.workingDir,
    env: params.executionEnv.env,
  };

  // Use spawn if available on the executor, otherwise execute
  const spawned = 'spawn' in params.executor
    ? await (params.executor as any).spawn(request, msgStore)
    : undefined;

  return { spawned, msgStore };
}
