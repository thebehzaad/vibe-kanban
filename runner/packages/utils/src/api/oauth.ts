/**
 * OAuth API types
 * Translates: crates/utils/src/api/oauth.rs
 *
 * API types for OAuth authentication.
 */

export interface OAuthProvider {
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string[];
}

export interface OAuthTokenRequest {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scope?: string[];
}

export interface OAuthRefreshRequest {
  refreshToken: string;
}

export interface OAuthUserInfo {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  provider: string;
}
