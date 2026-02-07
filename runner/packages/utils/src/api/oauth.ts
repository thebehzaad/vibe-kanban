/**
 * OAuth API types
 * Translates: crates/utils/src/api/oauth.rs
 */

export interface HandoffInitRequest {
  provider: string;
  returnTo: string;
  appChallenge: string;
}

export interface HandoffInitResponse {
  handoffId: string;
  authorizeUrl: string;
}

export interface HandoffRedeemRequest {
  handoffId: string;
  appCode: string;
  appVerifier: string;
}

export interface HandoffRedeemResponse {
  accessToken: string;
  refreshToken: string;
}

export interface TokenRefreshRequest {
  refreshToken: string;
}

export interface TokenRefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface ProviderProfile {
  provider: string;
  username?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

export interface ProfileResponse {
  userId: string;
  username?: string;
  email: string;
  providers: ProviderProfile[];
}

export interface StatusResponse {
  loggedIn: boolean;
  profile?: ProfileResponse;
  degraded?: boolean;
}

/** Tagged union matching Rust: #[serde(tag = "status", rename_all = "lowercase")] */
export type LoginStatus =
  | { status: 'loggedout' }
  | { status: 'loggedin'; profile: ProfileResponse };
