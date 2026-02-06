/**
 * Exit signal handling for graceful shutdown
 * Translates: crates/utils/src/exit_signal.rs
 */

type CleanupFn = () => void | Promise<void>;

const cleanupFns: CleanupFn[] = [];
let signalsRegistered = false;

/**
 * Register a cleanup function to run on process exit
 */
export function onExit(fn: CleanupFn): void {
  cleanupFns.push(fn);
  ensureSignalsRegistered();
}

/**
 * Run all cleanup functions
 */
async function runCleanup(): Promise<void> {
  const fns = cleanupFns.splice(0);
  for (const fn of fns) {
    try {
      await fn();
    } catch (err) {
      console.error('Cleanup error:', err);
    }
  }
}

/**
 * Register signal handlers for graceful shutdown
 */
function ensureSignalsRegistered(): void {
  if (signalsRegistered) return;
  signalsRegistered = true;

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

  for (const signal of signals) {
    process.on(signal, async () => {
      await runCleanup();
      process.exit(0);
    });
  }

  process.on('beforeExit', async () => {
    await runCleanup();
  });
}

/**
 * Create an abort controller that aborts on process exit signals
 */
export function createExitSignal(): AbortController {
  const controller = new AbortController();

  const handler = () => {
    controller.abort();
  };

  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);

  return controller;
}

/**
 * Wait for an exit signal
 */
export function waitForExitSignal(): Promise<string> {
  return new Promise((resolve) => {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const signal of signals) {
      process.once(signal, () => resolve(signal));
    }
  });
}
