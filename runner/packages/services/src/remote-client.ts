/**
 * Remote client service
 * Translates: crates/services/src/services/remote_client.rs
 *
 * OAuth HTTP client for the remote server with exponential backoff retry,
 * automatic token refresh, and typed API methods.
 */

import { API, extractExpiration } from '@runner/utils';

import { AuthContext } from './auth.js';
import { expiresSoon, type Credentials } from './oauth-credentials.js';

// ── Error ──

export type RemoteClientErrorCode =
  | 'transport'
  | 'timeout'
  | 'http'
  | 'api'
  | 'auth'
  | 'serde'
  | 'url'
  | 'storage'
  | 'token';

export type HandoffErrorCode =
  | 'unsupported_provider'
  | 'invalid_return_url'
  | 'invalid_challenge'
  | 'provider_error'
  | 'not_found'
  | 'expired'
  | 'access_denied'
  | 'internal_error'
  | 'other';

export class RemoteClientError extends Error {
  readonly code: RemoteClientErrorCode;
  readonly status?: number;
  readonly body?: string;
  readonly apiErrorCode?: HandoffErrorCode;

  constructor(code: RemoteClientErrorCode, message: string, opts?: { status?: number; body?: string; apiErrorCode?: HandoffErrorCode }) {
    super(message);
    this.name = 'RemoteClientError';
    this.code = code;
    this.status = opts?.status;
    this.body = opts?.body;
    this.apiErrorCode = opts?.apiErrorCode;
  }

  /** Returns true if the error is transient and should be retried. */
  shouldRetry(): boolean {
    switch (this.code) {
      case 'transport':
      case 'timeout':
        return true;
      case 'http':
        return this.status !== undefined && this.status >= 500 && this.status <= 599;
      default:
        return false;
    }
  }

  static transport(msg: string): RemoteClientError {
    return new RemoteClientError('transport', `network error: ${msg}`);
  }

  static timeout(): RemoteClientError {
    return new RemoteClientError('timeout', 'timeout');
  }

  static http(status: number, body: string): RemoteClientError {
    return new RemoteClientError('http', `http ${status}: ${body}`, { status, body });
  }

  static api(code: HandoffErrorCode): RemoteClientError {
    return new RemoteClientError('api', `api error: ${code}`, { apiErrorCode: code });
  }

  static auth(): RemoteClientError {
    return new RemoteClientError('auth', 'unauthorized');
  }

  static serde(msg: string): RemoteClientError {
    return new RemoteClientError('serde', `json error: ${msg}`);
  }

  static url(msg: string): RemoteClientError {
    return new RemoteClientError('url', `url error: ${msg}`);
  }

  static storage(msg: string): RemoteClientError {
    return new RemoteClientError('storage', `credentials storage error: ${msg}`);
  }

  static token(msg: string): RemoteClientError {
    return new RemoteClientError('token', `invalid access token: ${msg}`);
  }
}

// ── Helpers ──

function mapErrorCode(code?: string): HandoffErrorCode {
  switch (code ?? 'internal_error') {
    case 'unsupported_provider': return 'unsupported_provider';
    case 'invalid_return_url': return 'invalid_return_url';
    case 'invalid_challenge': return 'invalid_challenge';
    case 'provider_error': return 'provider_error';
    case 'not_found': return 'not_found';
    case 'expired': case 'expired_token': return 'expired';
    case 'access_denied': return 'access_denied';
    case 'internal_error': return 'internal_error';
    default: return 'other';
  }
}

interface ApiErrorResponse {
  error: string;
}

/** Retry a function with exponential backoff */
async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: RemoteClientError) => boolean,
  maxRetries: number = 2,
): Promise<T> {
  let lastError: RemoteClientError | undefined;
  let delay = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RemoteClientError && shouldRetry(err) && attempt < maxRetries) {
        lastError = err;
        const jitter = Math.random() * delay * 0.5;
        console.warn(
          `Remote call failed, retrying after ${((delay + jitter) / 1000).toFixed(2)}s: ${err.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        delay = Math.min(delay * 2, 2000);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

// ── RemoteClient ──

export class RemoteClient {
  private static readonly REQUEST_TIMEOUT = 30_000;
  private static readonly TOKEN_REFRESH_LEEWAY_MS = 20_000;

  private baseUrl: string;
  private authContext: AuthContext;

  constructor(baseUrl: string, authContext: AuthContext) {
    // Validate URL
    try {
      new URL(baseUrl);
    } catch (e) {
      throw RemoteClientError.url((e as Error).message);
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authContext = authContext;
  }

  /** Returns the base URL for the client. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** Returns a valid access token, refreshing when it's about to expire. */
  private async requireToken(): Promise<string> {
    const creds = await this.authContext.getCredentials();
    if (!creds) {
      throw RemoteClientError.auth();
    }

    if (creds.accessToken && !expiresSoon(creds, RemoteClient.TOKEN_REFRESH_LEEWAY_MS)) {
      return creds.accessToken;
    }

    // Acquire refresh guard to serialize refresh attempts
    const release = await this.authContext.refreshGuard();
    try {
      // Re-check after acquiring lock
      const latest = await this.authContext.getCredentials();
      if (!latest) {
        throw RemoteClientError.auth();
      }

      if (latest.accessToken && !expiresSoon(latest, RemoteClient.TOKEN_REFRESH_LEEWAY_MS)) {
        return latest.accessToken;
      }

      const refreshed = await this.refreshCredentials(latest);
      if (!refreshed.accessToken) {
        throw RemoteClientError.auth();
      }
      return refreshed.accessToken;
    } catch (err) {
      if (err instanceof RemoteClientError && err.code === 'auth') {
        await this.authContext.clearCredentials();
      }
      throw err;
    } finally {
      release();
    }
  }

  private async refreshCredentials(creds: Credentials): Promise<Credentials> {
    const response = await this.refreshTokenRequest(creds.refreshToken);
    const expiresAt = extractExpiration(response.accessToken);

    const newCreds: Credentials = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    };

    try {
      await this.authContext.saveCredentials(newCreds);
    } catch (e) {
      throw RemoteClientError.storage((e as Error).message);
    }

    return newCreds;
  }

  private async refreshTokenRequest(refreshToken: string): Promise<API.TokenRefreshResponse> {
    const request: API.TokenRefreshRequest = { refreshToken };
    try {
      return await this.postPublic<API.TokenRefreshResponse>('/v1/tokens/refresh', request);
    } catch (err) {
      throw this.mapApiError(err as RemoteClientError);
    }
  }

  /** Returns a valid access token for external use (e.g. WebSocket connections). */
  async accessToken(): Promise<string> {
    return this.requireToken();
  }

  // ── Core HTTP methods ──

  private async send<B>(
    method: string,
    path: string,
    requiresAuth: boolean,
    body?: B,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    return withRetry(
      async () => {
        const headers: Record<string, string> = {
          'X-Client-Type': 'local-backend',
        };

        if (requiresAuth) {
          const token = await this.requireToken();
          headers['Authorization'] = `Bearer ${token}`;
        }

        const init: RequestInit = {
          method,
          headers,
          signal: AbortSignal.timeout(RemoteClient.REQUEST_TIMEOUT),
        };

        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }

        let res: Response;
        try {
          res = await fetch(url, init);
        } catch (e) {
          const err = e as Error;
          if (err.name === 'AbortError' || err.name === 'TimeoutError') {
            throw RemoteClientError.timeout();
          }
          throw RemoteClientError.transport(err.message);
        }

        if (res.ok) {
          return res;
        }

        if (res.status === 401 || res.status === 403) {
          throw RemoteClientError.auth();
        }

        const resBody = await res.text().catch(() => '');
        throw RemoteClientError.http(res.status, resBody);
      },
      (e) => e.shouldRetry(),
    );
  }

  // ── Public endpoint helpers (no auth required) ──

  private async getPublic<T>(path: string): Promise<T> {
    const res = await this.send('GET', path, false);
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw RemoteClientError.serde((e as Error).message);
    }
  }

  private async postPublic<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.send('POST', path, false, body);
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw RemoteClientError.serde((e as Error).message);
    }
  }

  // ── Authenticated endpoint helpers ──

  private async getAuthed<T>(path: string): Promise<T> {
    const res = await this.send('GET', path, true);
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw RemoteClientError.serde((e as Error).message);
    }
  }

  async postAuthed<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.send('POST', path, true, body);
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw RemoteClientError.serde((e as Error).message);
    }
  }

  private async patchAuthed<T>(path: string, body: unknown): Promise<T> {
    const res = await this.send('PATCH', path, true, body);
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw RemoteClientError.serde((e as Error).message);
    }
  }

  private async deleteAuthed(path: string): Promise<void> {
    await this.send('DELETE', path, true);
  }

  private async deleteAuthedWithBody(path: string, body: unknown): Promise<void> {
    await this.send('DELETE', path, true, body);
  }

  private mapApiError(err: RemoteClientError): RemoteClientError {
    if (err.code === 'http' && err.body) {
      try {
        const apiErr = JSON.parse(err.body) as ApiErrorResponse;
        return RemoteClientError.api(mapErrorCode(apiErr.error));
      } catch {
        // not an API error response
      }
    }
    return err;
  }

  // ── OAuth endpoints ──

  async handoffInit(request: API.HandoffInitRequest): Promise<API.HandoffInitResponse> {
    try {
      return await this.postPublic<API.HandoffInitResponse>('/v1/oauth/web/init', request);
    } catch (err) {
      throw this.mapApiError(err as RemoteClientError);
    }
  }

  async handoffRedeem(request: API.HandoffRedeemRequest): Promise<API.HandoffRedeemResponse> {
    try {
      return await this.postPublic<API.HandoffRedeemResponse>('/v1/oauth/web/redeem', request);
    } catch (err) {
      throw this.mapApiError(err as RemoteClientError);
    }
  }

  async getInvitation(invitationToken: string): Promise<API.GetInvitationResponse> {
    return this.getPublic<API.GetInvitationResponse>(`/v1/invitations/${invitationToken}`);
  }

  // ── Profile ──

  async profile(): Promise<API.ProfileResponse> {
    return this.getAuthed<API.ProfileResponse>('/v1/profile');
  }

  async logout(): Promise<void> {
    return this.deleteAuthed('/v1/oauth/logout');
  }

  // ── Organizations ──

  async listOrganizations(): Promise<API.ListOrganizationsResponse> {
    return this.getAuthed<API.ListOrganizationsResponse>('/v1/organizations');
  }

  async getOrganization(orgId: string): Promise<API.GetOrganizationResponse> {
    return this.getAuthed<API.GetOrganizationResponse>(`/v1/organizations/${orgId}`);
  }

  async createOrganization(request: API.CreateOrganizationRequest): Promise<API.CreateOrganizationResponse> {
    return this.postAuthed<API.CreateOrganizationResponse>('/v1/organizations', request);
  }

  async updateOrganization(orgId: string, request: API.UpdateOrganizationRequest): Promise<API.Organization> {
    return this.patchAuthed<API.Organization>(`/v1/organizations/${orgId}`, request);
  }

  async deleteOrganization(orgId: string): Promise<void> {
    return this.deleteAuthed(`/v1/organizations/${orgId}`);
  }

  // ── Invitations ──

  async createInvitation(orgId: string, request: API.CreateInvitationRequest): Promise<API.CreateInvitationResponse> {
    return this.postAuthed<API.CreateInvitationResponse>(`/v1/organizations/${orgId}/invitations`, request);
  }

  async listInvitations(orgId: string): Promise<API.ListInvitationsResponse> {
    return this.getAuthed<API.ListInvitationsResponse>(`/v1/organizations/${orgId}/invitations`);
  }

  async revokeInvitation(orgId: string, invitationId: string): Promise<void> {
    await this.send('POST', `/v1/organizations/${orgId}/invitations/revoke`, true, { invitationId });
  }

  async acceptInvitation(invitationToken: string): Promise<API.AcceptInvitationResponse> {
    return this.postAuthed<API.AcceptInvitationResponse>(`/v1/invitations/${invitationToken}/accept`);
  }

  // ── Members ──

  async listMembers(orgId: string): Promise<API.ListMembersResponse> {
    return this.getAuthed<API.ListMembersResponse>(`/v1/organizations/${orgId}/members`);
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    return this.deleteAuthed(`/v1/organizations/${orgId}/members/${userId}`);
  }

  async updateMemberRole(orgId: string, userId: string, request: API.UpdateMemberRoleRequest): Promise<API.UpdateMemberRoleResponse> {
    return this.patchAuthed<API.UpdateMemberRoleResponse>(`/v1/organizations/${orgId}/members/${userId}/role`, request);
  }

  // ── Workspaces ──

  async deleteWorkspace(localWorkspaceId: string): Promise<void> {
    return this.deleteAuthedWithBody('/v1/workspaces', { localWorkspaceId });
  }

  async workspaceExists(localWorkspaceId: string): Promise<boolean> {
    try {
      await this.send('HEAD', `/v1/workspaces/exists/${localWorkspaceId}`, true);
      return true;
    } catch (err) {
      if (err instanceof RemoteClientError && err.code === 'http' && err.status === 404) {
        return false;
      }
      throw err;
    }
  }

  async updateWorkspace(
    localWorkspaceId: string,
    name?: string | null,
    archived?: boolean,
    filesChanged?: number,
    linesAdded?: number,
    linesRemoved?: number,
  ): Promise<void> {
    await this.send('PATCH', '/v1/workspaces', true, {
      localWorkspaceId,
      name,
      archived,
      filesChanged,
      linesAdded,
      linesRemoved,
    });
  }

  async createWorkspace(request: API.CreateWorkspaceRequest): Promise<void> {
    await this.send('POST', '/v1/workspaces', true, request);
  }

  // ── Pull Requests ──

  async upsertPullRequest(request: API.UpsertPullRequestRequest): Promise<void> {
    await this.send('PUT', '/v1/pull_requests', true, request);
  }
}
