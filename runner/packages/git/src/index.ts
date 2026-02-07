/**
 * @runner/git
 *
 * Git operations and utilities.
 * TypeScript translation of crates/git.
 */

export * from './cli.js';
export * from './validation.js';
export * from './git-service.js';

// Re-export commonly used types
export type {
  GitBranch,
  GitRemote,
  HeadInfo,
  FileStat,
  WorktreeResetOptions,
  WorktreeResetOutcome,
  DiffTarget
} from './git-service.js';

export {
  GitService,
  GitServiceError,
  Commit,
  ConflictOp
} from './git-service.js';

export {
  GitCli,
  GitCliError,
  ChangeType,
  WorktreeStatus,
  StatusEntry,
  StatusDiffEntry,
  WorktreeEntry
} from './cli.js';

export {
  isValidBranchPrefix,
  isValidBranchName
} from './validation.js';
