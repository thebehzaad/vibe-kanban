/**
 * Executor actions
 * Translates: crates/executors/src/actions/mod.rs
 */

import type { ExecutorApprovalService } from '../approvals.js';
import type { ExecutionEnv } from '../env.js';
import type { BaseCodingAgent, SpawnedChild } from '../executors/index.js';
import type { CodingAgentInitialRequest } from './coding-agent-initial.js';
import type { CodingAgentFollowUpRequest } from './coding-agent-follow-up.js';
import type { ReviewRequest } from './review.js';
import type { ScriptRequest } from './script.js';

export { CodingAgentInitialRequest } from './coding-agent-initial.js';
export { CodingAgentFollowUpRequest } from './coding-agent-follow-up.js';
export { ReviewRequest, type RepoReviewContext } from './review.js';
export { ScriptRequest, ScriptRequestLanguage, ScriptContext } from './script.js';

// --- ExecutorActionType (tagged union - matches enum_dispatch) ---

export type ExecutorActionType =
  | { type: 'CodingAgentInitialRequest'; request: CodingAgentInitialRequest }
  | { type: 'CodingAgentFollowUpRequest'; request: CodingAgentFollowUpRequest }
  | { type: 'ScriptRequest'; request: ScriptRequest }
  | { type: 'ReviewRequest'; request: ReviewRequest };

// --- Executable (trait → interface) ---

export interface Executable {
  spawn(
    currentDir: string,
    approvals: ExecutorApprovalService,
    env: ExecutionEnv,
  ): Promise<SpawnedChild>;
}

// --- ExecutorAction ---

export class ExecutorAction implements Executable {
  public readonly typ: ExecutorActionType;
  public readonly nextAction: ExecutorAction | undefined;

  constructor(typ: ExecutorActionType, nextAction?: ExecutorAction) {
    this.typ = typ;
    this.nextAction = nextAction;
  }

  appendAction(action: ExecutorAction): ExecutorAction {
    if (this.nextAction) {
      return new ExecutorAction(this.typ, this.nextAction.appendAction(action));
    }
    return new ExecutorAction(this.typ, action);
  }

  baseExecutor(): BaseCodingAgent | undefined {
    switch (this.typ.type) {
      case 'CodingAgentInitialRequest':
        return this.typ.request.baseExecutor();
      case 'CodingAgentFollowUpRequest':
        return this.typ.request.baseExecutor();
      case 'ReviewRequest':
        return this.typ.request.baseExecutor();
      case 'ScriptRequest':
        return undefined;
    }
  }

  async spawn(
    currentDir: string,
    approvals: ExecutorApprovalService,
    env: ExecutionEnv,
  ): Promise<SpawnedChild> {
    return spawnActionType(this.typ, currentDir, approvals, env);
  }
}

// --- Internal dispatch ---

async function spawnActionType(
  actionType: ExecutorActionType,
  currentDir: string,
  approvals: ExecutorApprovalService,
  env: ExecutionEnv,
): Promise<SpawnedChild> {
  switch (actionType.type) {
    case 'CodingAgentInitialRequest':
      return actionType.request.spawn(currentDir, approvals, env);
    case 'CodingAgentFollowUpRequest':
      return actionType.request.spawn(currentDir, approvals, env);
    case 'ReviewRequest':
      return actionType.request.spawn(currentDir, approvals, env);
    case 'ScriptRequest':
      return actionType.request.spawn(currentDir, approvals, env);
  }
}
