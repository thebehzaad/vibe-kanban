/**
 * Script execution action
 * Translates: crates/executors/src/actions/script.rs
 *
 * Executes a shell script (bash/powershell) with the given context.
 * Supports setup, cleanup, archive, and devserver script contexts.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  MsgStore,
  stdoutMsg,
  stderrMsg,
  finishedMsg,
  getShellCommand,
  runShellCommand,
} from '@orchestrator/utils';
import type { ExecutionEnv, SpawnedChild } from '../types.js';

/** The context in which a script is being executed */
export type ScriptContext = 'setup' | 'cleanup' | 'archive' | 'devserver';

export interface ScriptRequestParams {
  /** The script content to execute */
  script: string;
  /** The context for this script execution */
  context: ScriptContext;
  /** The execution environment */
  executionEnv: ExecutionEnv;
  /** Optional timeout in milliseconds */
  timeout?: number;
}

export interface ScriptResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Execute a script as a spawned child process (for long-running scripts like devserver) */
export function spawnScript(params: ScriptRequestParams): { spawned: SpawnedChild; msgStore: MsgStore } {
  const msgStore = new MsgStore(crypto.randomUUID());
  const { shell, shellArg } = getShellCommand();
  const abortController = new AbortController();

  const proc = spawn(shell, [shellArg, params.script], {
    cwd: params.executionEnv.workingDir,
    env: {
      ...process.env as Record<string, string>,
      ...params.executionEnv.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: abortController.signal,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    msgStore.push(stdoutMsg(data.toString()));
  });

  proc.stderr?.on('data', (data: Buffer) => {
    msgStore.push(stderrMsg(data.toString()));
  });

  proc.on('close', (code) => {
    msgStore.push(finishedMsg(code ?? 1));
    msgStore.close();
  });

  // Apply timeout if specified (not for devserver which runs indefinitely)
  if (params.timeout && params.context !== 'devserver') {
    setTimeout(() => {
      if (!msgStore.isClosed) {
        abortController.abort();
      }
    }, params.timeout);
  }

  const spawned: SpawnedChild = {
    process: proc,
    pid: proc.pid ?? 0,
    msgStore,
    abortController,
  };

  return { spawned, msgStore };
}

/** Execute a script and wait for it to complete (for setup/cleanup/archive) */
export async function executeScript(params: ScriptRequestParams): Promise<ScriptResult> {
  const result = await runShellCommand(params.script, {
    cwd: params.executionEnv.workingDir,
    env: {
      ...process.env as Record<string, string>,
      ...params.executionEnv.env,
    },
  });

  return {
    success: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

/** Execute a script request, choosing spawn vs execute based on context */
export async function executeScriptRequest(
  params: ScriptRequestParams,
): Promise<{ result?: ScriptResult; spawned?: SpawnedChild; msgStore: MsgStore }> {
  // Devserver scripts are long-running and should be spawned
  if (params.context === 'devserver') {
    const { spawned, msgStore } = spawnScript(params);
    return { spawned, msgStore };
  }

  // Other scripts (setup, cleanup, archive) run to completion
  const result = await executeScript(params);
  const msgStore = new MsgStore(crypto.randomUUID());

  if (result.stdout) {
    msgStore.push(stdoutMsg(result.stdout));
  }
  if (result.stderr) {
    msgStore.push(stderrMsg(result.stderr));
  }
  msgStore.push(finishedMsg(result.exitCode));
  msgStore.close();

  return { result, msgStore };
}
