/**
 * Cursor agent executor
 * Translates: crates/executors/src/executors/cursor.rs
 */

import { spawn } from 'node:child_process';
import type { MsgStore } from '@runner/utils';
import { CommandBuilder, applyOverrides, type CmdOverrides } from '../command.js';
import type { ExecutionEnv } from '../env.js';
import type { ExecutorApprovalService } from '../approvals.js';
import {
  type StandardCodingAgentExecutor,
  type SpawnedChild,
  type AvailabilityInfo,
  AppendPrompt,
  ExecutorError,
} from './index.js';

const BASE_COMMAND = 'cursor';

export interface CursorAgentConfig {
  appendPrompt?: AppendPrompt;
  cmd: CmdOverrides;
}

export class CursorAgent implements StandardCodingAgentExecutor {
  public appendPrompt: AppendPrompt;
  public cmd: CmdOverrides;
  private approvalsService?: ExecutorApprovalService;

  constructor(config: Partial<CursorAgentConfig> = {}) {
    this.appendPrompt = config.appendPrompt ?? new AppendPrompt();
    this.cmd = config.cmd ?? {};
  }

  useApprovals(approvals: ExecutorApprovalService): void {
    this.approvalsService = approvals;
  }

  private buildCommandBuilder(): CommandBuilder {
    let builder = new CommandBuilder(BASE_COMMAND);
    builder = applyOverrides(builder, this.cmd);
    return builder;
  }

  async spawn(
    currentDir: string,
    prompt: string,
    env: ExecutionEnv,
  ): Promise<SpawnedChild> {
    const combinedPrompt = this.appendPrompt.combinePrompt(prompt);
    const builder = this.buildCommandBuilder();
    const parts = builder.buildInitial();
    const resolved = await parts.intoResolved();

    const proc = spawn(resolved.executable, [...resolved.args, combinedPrompt], {
      cwd: currentDir,
      env: env.applyToCommand(process.env as Record<string, string>),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { child: proc };
  }

  async spawnFollowUp(
    _currentDir: string,
    _prompt: string,
    _sessionId: string,
    _resetToMessageId: string | undefined,
    _env: ExecutionEnv,
  ): Promise<SpawnedChild> {
    throw ExecutorError.followUpNotSupported('CursorAgent');
  }

  normalizeLogs(_rawLogsMsgStore: MsgStore, _worktreePath: string): void {
    // TODO: Implement Cursor-specific log normalization
  }

  defaultMcpConfigPath(): string | undefined {
    return undefined;
  }
}
