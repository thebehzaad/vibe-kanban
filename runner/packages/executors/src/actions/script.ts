/**
 * Script execution action
 * Translates: crates/executors/src/actions/script.rs
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { getShellCommand } from '@runner/utils';
import type { ExecutorApprovalService } from '../approvals.js';
import type { ExecutionEnv } from '../env.js';
import type { SpawnedChild } from '../executors/index.js';
import type { Executable } from './index.js';

// --- ScriptRequestLanguage ---

export enum ScriptRequestLanguage {
  Bash = 'Bash',
}

// --- ScriptContext ---

export enum ScriptContext {
  SetupScript = 'SetupScript',
  CleanupScript = 'CleanupScript',
  ArchiveScript = 'ArchiveScript',
  DevServer = 'DevServer',
  ToolInstallScript = 'ToolInstallScript',
}

// --- ScriptRequest ---

export class ScriptRequest implements Executable {
  public readonly script: string;
  public readonly language: ScriptRequestLanguage;
  public readonly context: ScriptContext;
  public readonly workingDir?: string;

  constructor(params: {
    script: string;
    language: ScriptRequestLanguage;
    context: ScriptContext;
    workingDir?: string;
  }) {
    this.script = params.script;
    this.language = params.language;
    this.context = params.context;
    this.workingDir = params.workingDir;
  }

  async spawn(
    currentDir: string,
    _approvals: ExecutorApprovalService,
    env: ExecutionEnv,
  ): Promise<SpawnedChild> {
    const effectiveDir = this.workingDir
      ? path.join(currentDir, this.workingDir)
      : currentDir;

    const { shell, shellArg } = getShellCommand();

    const proc = spawn(shell, [shellArg, this.script], {
      cwd: effectiveDir,
      env: env.applyToCommand(process.env as Record<string, string>),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      child: proc,
    };
  }
}
