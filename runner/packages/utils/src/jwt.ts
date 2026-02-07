/**
 * JWT utilities
 * Translates: crates/utils/src/jwt.rs
 */

export class TokenClaimsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenClaimsError';
  }
}

interface JwtPayload {
  exp?: number;
  sub?: string;
  iat?: number;
  [key: string]: unknown;
}

/**
 * Decode a JWT token without verification (insecure - use only for extracting claims)
 * Note: This does NOT verify the signature. Do not use this for authentication.
 */
export function decodeJwtPayload(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenClaimsError('Invalid JWT format: expected 3 parts');
  }

  try {
    // Decode base64url to base64
    const base64Part = parts[1];
    if (!base64Part) {
      throw new TokenClaimsError('Invalid JWT: missing payload');
    }
    const base64 = base64Part
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    // Add padding if needed
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);

    // Decode
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as JwtPayload;
  } catch (error) {
    throw new TokenClaimsError(`Failed to decode JWT payload: ${error}`);
  }
}

/**
 * Extract the expiration timestamp from a JWT without verifying its signature.
 * Returns the expiration as a Date object.
 */
export function extractExpiration(token: string): Date {
  const payload = decodeJwtPayload(token);

  if (payload.exp === undefined) {
    throw new TokenClaimsError('Missing `exp` claim in token');
  }

  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new TokenClaimsError(`Invalid \`exp\` value: ${exp}`);
  }

  // exp is in seconds since epoch
  const date = new Date(exp * 1000);
  if (isNaN(date.getTime())) {
    throw new TokenClaimsError(`Invalid \`exp\` value: ${exp}`);
  }

  return date;
}

/**
 * Extract the subject (user ID) from a JWT without verifying its signature.
 */
export function extractSubject(token: string): string {
  const payload = decodeJwtPayload(token);

  if (payload.sub === undefined) {
    throw new TokenClaimsError('Missing `sub` claim in token');
  }

  const sub = payload.sub;
  if (typeof sub !== 'string' || sub.trim() === '') {
    throw new TokenClaimsError(`Invalid \`sub\` value: ${sub}`);
  }

  return sub;
}

/**
 * Check if a token is expired
 */
export function isTokenExpired(token: string, bufferSeconds: number = 0): boolean {
  try {
    const expiration = extractExpiration(token);
    const now = new Date();
    const bufferMs = bufferSeconds * 1000;
    return expiration.getTime() - bufferMs <= now.getTime();
  } catch {
    // If we can't extract expiration, consider it expired
    return true;
  }
}

/**
 * Get time until token expires in seconds
 */
export function getTokenTTL(token: string): number {
  try {
    const expiration = extractExpiration(token);
    const now = new Date();
    const ttlMs = expiration.getTime() - now.getTime();
    return Math.max(0, Math.floor(ttlMs / 1000));
  } catch {
    return 0;
  }
}
