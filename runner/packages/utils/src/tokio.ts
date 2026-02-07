/**
 * Tokio async utilities
 * Translates: crates/utils/src/tokio.rs
 *
 * Async runtime utilities (Node.js equivalents).
 */

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`Operation timed out after ${ms}ms`);
    })
  ]);
}

export function spawn<T>(fn: () => Promise<T>): Promise<T> {
  // In Node.js, promises are already async
  return fn();
}
