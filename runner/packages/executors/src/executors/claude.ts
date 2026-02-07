/**
 * Claude Code executor
 * Translates: crates/executors/src/executors/claude.rs
 */

import { spawn } from 'node:child_process';
import { resolveExecutablePathBlocking } from '@runner/utils';
import type { MsgStore } from '@runner/utils';
import { CommandBuilder, applyOverrides, type CmdOverrides } from '../command.js';
import type { ExecutionEnv } from '../env.js';
import type { ExecutorApprovalService } from '../approvals.js';
import {
  type StandardCodingAgentExecutor,
  type SpawnedChild,
  type AvailabilityInfo,
  type BaseAgentCapability,
  type SlashCommandDescription,
  AppendPrompt,
  ExecutorError,
} from './index.js';

const BASE_COMMAND = 'npx -y @anthropic-ai/claude-code@latest';
const BASE_COMMAND_ROUTER = 'npx -y @musistudio/claude-code-router@latest code';

export interface ClaudeCodeConfig {
  appendPrompt?: AppendPrompt;
  claudeCodeRouter?: boolean;
  plan?: boolean;
  approvals?: boolean;
  model?: string;
  dangerouslySkipPermissions?: boolean;
  disableApiKey?: boolean;
  cmd: CmdOverrides;
}

export class ClaudeCode implements StandardCodingAgentExecutor {
  public appendPrompt: AppendPrompt;
  public claudeCodeRouter?: boolean;
  public plan?: boolean;
  public approvalsEnabled?: boolean;
  public model?: string;
  public dangerouslySkipPermissions?: boolean;
  public disableApiKey?: boolean;
  public cmd: CmdOverrides;
  private approvalsService?: ExecutorApprovalService;

  constructor(config: Partial<ClaudeCodeConfig> = {}) {
    this.appendPrompt = config.appendPrompt ?? new AppendPrompt();
    this.claudeCodeRouter = config.claudeCodeRouter;
    this.plan = config.plan;
    this.approvalsEnabled = config.approvals;
    this.model = config.model;
    this.dangerouslySkipPermissions = config.dangerouslySkipPermissions;
    this.disableApiKey = config.disableApiKey;
    this.cmd = config.cmd ?? {};
  }

  useApprovals(approvals: ExecutorApprovalService): void {
    this.approvalsService = approvals;
  }

  private buildCommandBuilder(): CommandBuilder {
    const base = this.claudeCodeRouter ? BASE_COMMAND_ROUTER : BASE_COMMAND;
    let builder = new CommandBuilder(base).setParams(['-p']);

    if (this.model) {
      builder.extendParams(['--model', this.model]);
    }

    if (this.dangerouslySkipPermissions) {
      builder.extendParams(['--dangerously-skip-permissions']);
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

    return {
      child: proc,
    };
  }

  async spawnFollowUp(
    currentDir: string,
    prompt: string,
    sessionId: string,
    resetToMessageId: string | undefined,
    env: ExecutionEnv,
  ): Promise<SpawnedChild> {
    const combinedPrompt = this.appendPrompt.combinePrompt(prompt);
    const builder = this.buildCommandBuilder();
    const additionalArgs = ['--resume', sessionId];
    if (resetToMessageId) {
      additionalArgs.push('--continue');
    }
    const parts = builder.buildFollowUp(additionalArgs);
    const resolved = await parts.intoResolved();

    const proc = spawn(resolved.executable, [...resolved.args, combinedPrompt], {
      cwd: currentDir,
      env: env.applyToCommand(process.env as Record<string, string>),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      child: proc,
    };
  }

  normalizeLogs(_rawLogsMsgStore: MsgStore, _worktreePath: string): void {
    // TODO: Implement Claude-specific log normalization
  }

  defaultMcpConfigPath(): string | undefined {
    // Claude Code uses ~/.claude/claude_desktop_config.json
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) return undefined;
    return `${home}/.claude/claude_desktop_config.json`;
  }

  getAvailabilityInfo(): AvailabilityInfo {
    const configPath = this.defaultMcpConfigPath();
    if (configPath) {
      try {
        const fs = require('node:fs');
        if (fs.existsSync(configPath)) {
          return { type: 'INSTALLATION_FOUND' };
        }
      } catch {
        // ignore
      }
    }
    return { type: 'NOT_FOUND' };
  }
}
