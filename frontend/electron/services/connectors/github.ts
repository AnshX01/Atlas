/**
 * Direct GitHub API connector.
 * Uses stored Personal Access Token to call GitHub REST API.
 */
import { getToken } from '../token-store';

export class GitHubConnector {
  private token: string | null = null;

  async init(): Promise<boolean> {
    const creds = getToken('github') as Record<string, string> | null;
    this.token = creds?.personal_access_token || creds?.access_token || null;
    return !!this.token;
  }

  private async api(path: string, options: RequestInit = {}): Promise<any> {
    // Sync memory with disk for cross-device updates
    const creds = getToken('github') as Record<string, string> | null;
    const currentToken = creds?.personal_access_token || creds?.access_token || null;
    if (currentToken && currentToken !== this.token) {
      this.token = currentToken;
    }

    if (!this.token) throw new Error('GitHub not configured');
    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async listPRs(state: string = 'open'): Promise<any[]> {
    const user = await this.api('/user');
    // Get PRs where user is involved
    const prs = await this.api(`/search/issues?q=is:pr+is:${state}+involves:${user.login}&sort=updated&order=desc&per_page=10`);
    return prs.items || [];
  }

  async getPR(owner: string, repo: string, number: number): Promise<any> {
    return this.api(`/repos/${owner}/${repo}/pulls/${number}`);
  }

  async listIssues(): Promise<any[]> {
    const issues = await this.api('/issues?filter=assigned&state=open&sort=updated&per_page=10');
    return issues;
  }

  async listRepos(): Promise<any[]> {
    const repos = await this.api('/user/repos?sort=updated&per_page=10');
    return repos;
  }

  async mergePR(owner: string, repo: string, number: number): Promise<any> {
    return this.api(`/repos/${owner}/${repo}/pulls/${number}/merge`, { method: 'PUT' });
  }

  async searchCode(query: string): Promise<any[]> {
    const results = await this.api(`/search/code?q=${encodeURIComponent(query)}&per_page=5`);
    return results.items || [];
  }
}
