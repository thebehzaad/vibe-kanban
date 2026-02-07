/**
 * Executor environment utilities
 * Translates: crates/executors/src/env.rs
 *
 * Environment variable management for executors.
 */

export function getExecutorEnv(executorType: string): Record<string, string> {
  // TODO: Implement executor-specific environment variables
  return {};
}

export function mergeEnv(base: Record<string, string>, overrides: Record<string, string>): Record<string, string> {
  return { ...base, ...overrides };
}
