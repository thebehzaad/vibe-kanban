/**
 * GitHub integration
 * Translates: crates/services/src/services/git_host/github.rs
 */

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  url: string;
  private: boolean;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  createdAt: string;
}

export class GitHubService {
  // TODO: Implement GitHub API integration
  async getRepository(owner: string, repo: string): Promise<GitHubRepo> {
    throw new Error('Not implemented');
  }

  async createPullRequest(owner: string, repo: string, title: string, head: string, base: string, body?: string): Promise<GitHubPullRequest> {
    throw new Error('Not implemented');
  }

  async listPullRequests(owner: string, repo: string): Promise<GitHubPullRequest[]> {
    throw new Error('Not implemented');
  }
}
