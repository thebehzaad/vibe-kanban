/**
 * Share module
 * Translates: crates/services/src/services/share.rs
 *
 * Share error types and re-exports for the share sub-modules
 * (config, publisher, status). Sub-modules will be added when
 * the Rust share/ directory is populated.
 */

// ── ShareError ──

export type ShareErrorCode =
  | 'database'
  | 'transport'
  | 'serialization'
  | 'url'
  | 'missing_config'
  | 'task_not_found'
  | 'project_not_found'
  | 'project_not_linked'
  | 'invalid_response'
  | 'already_shared'
  | 'missing_github_token'
  | 'git'
  | 'git_host'
  | 'missing_auth'
  | 'invalid_user_id'
  | 'invalid_organization_id'
  | 'remote_client';

export class ShareError extends Error {
  readonly code: ShareErrorCode;

  constructor(code: ShareErrorCode, message: string) {
    super(message);
    this.name = 'ShareError';
    this.code = code;
  }

  static database(err: Error): ShareError {
    return new ShareError('database', err.message);
  }

  static transport(err: Error): ShareError {
    return new ShareError('transport', err.message);
  }

  static serialization(err: Error): ShareError {
    return new ShareError('serialization', err.message);
  }

  static url(err: Error): ShareError {
    return new ShareError('url', err.message);
  }

  static missingConfig(field: string): ShareError {
    return new ShareError('missing_config', `share configuration missing: ${field}`);
  }

  static taskNotFound(id: string): ShareError {
    return new ShareError('task_not_found', `task ${id} not found`);
  }

  static projectNotFound(id: string): ShareError {
    return new ShareError('project_not_found', `project ${id} not found`);
  }

  static projectNotLinked(id: string): ShareError {
    return new ShareError('project_not_linked', `project ${id} is not linked to a remote project`);
  }

  static invalidResponse(): ShareError {
    return new ShareError('invalid_response', 'invalid response from remote share service');
  }

  static alreadyShared(id: string): ShareError {
    return new ShareError('already_shared', `task ${id} is already shared`);
  }

  static missingGitHubToken(): ShareError {
    return new ShareError('missing_github_token', 'GitHub token is required to fetch repository ID');
  }

  static git(err: Error): ShareError {
    return new ShareError('git', err.message);
  }

  static gitHost(err: Error): ShareError {
    return new ShareError('git_host', err.message);
  }

  static missingAuth(): ShareError {
    return new ShareError('missing_auth', 'share authentication missing or expired');
  }

  static invalidUserId(): ShareError {
    return new ShareError('invalid_user_id', 'invalid user ID format');
  }

  static invalidOrganizationId(): ShareError {
    return new ShareError('invalid_organization_id', 'invalid organization ID format');
  }

  static remoteClient(err: Error): ShareError {
    return new ShareError('remote_client', err.message);
  }
}
