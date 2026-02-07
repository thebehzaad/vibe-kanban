/**
 * JWT handling
 * Translates: crates/remote/src/auth/jwt.rs
 */

export interface JwtPayload {
  sub: string;
  exp: number;
  iat: number;
}

export function createJwt(payload: JwtPayload, secret: string): string {
  // TODO: Implement with jsonwebtoken
  throw new Error('Not implemented');
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  // TODO: Implement with jsonwebtoken
  throw new Error('Not implemented');
}
