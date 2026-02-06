/**
 * GitHub App OAuth flow
 * Translates: crates/remote/src/github_app/oauth.rs
 */

export interface GitHubAppInstallation {
  id: string;
  accountId: string;
  accountType: 'User' | 'Organization';
  accessToken: string;
  expiresAt: string;
}

export class GitHubAppOAuth {
  // TODO: Implement GitHub App OAuth flow
  async getInstallationToken(installationId: string): Promise<string> {
    throw new Error('Not implemented');
  }

  async handleCallback(code: string): Promise<GitHubAppInstallation> {
    throw new Error('Not implemented');
  }
}
