/**
 * Qwen Code executor
 * Translates: crates/executors/src/executors/qwen.rs
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

const BASE_COMMAND = 'qwen-code';

export interface QwenCodeConfig {
  appendPrompt?: AppendPrompt;
  model?: string;
  cmd: CmdOverrides;
}

export class QwenCode implements StandardCodingAgentExecutor {
  public appendPrompt: AppendPrompt;
  public model?: string;
  public cmd: CmdOverrides;
  private approvalsService?: ExecutorApprovalService;

  constructor(config: Partial<QwenCodeConfig> = {}) {
    this.appendPrompt = config.appendPrompt ?? new AppendPrompt();
    this.model = config.model;
    this.cmd = config.cmd ?? {};
  }

  useApprovals(approvals: ExecutorApprovalService): void {
    this.approvalsService = approvals;
  }

  private buildCommandBuilder(): CommandBuilder {
    let builder = new CommandBuilder(BASE_COMMAND);
    if (this.model) {
      builder.extendParams(['--model', this.model]);
    }
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
    currentDir: string,
    prompt: string,
    sessionId: string,
    _resetToMessageId: string | undefined,
    env: ExecutionEnv,
  ): Promise<SpawnedChild> {
    const combinedPrompt = this.appendPrompt.combinePrompt(prompt);
    const builder = this.buildCommandBuilder();
    const parts = builder.buildFollowUp(['--session', sessionId]);
    const resolved = await parts.intoResolved();

    const proc = spawn(resolved.executable, [...resolved.args, combinedPrompt], {
      cwd: currentDir,
      env: env.applyToCommand(process.env as Record<string, string>),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { child: proc };
  }

  normalizeLogs(_rawLogsMsgStore: MsgStore, _worktreePath: string): void {
    // TODO: Implement Qwen-specific log normalization
  }

  defaultMcpConfigPath(): string | undefined {
    return undefined;
  }
}
