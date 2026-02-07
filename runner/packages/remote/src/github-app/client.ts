/**
 * GitHub App API client
 * Translates: crates/remote/src/github_app/client.rs
 */

export class GitHubAppClient {
  // TODO: Implement GitHub App API client
  async getInstallation(installationId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async listRepositories(installationId: string): Promise<unknown[]> {
    throw new Error('Not implemented');
  }
}
