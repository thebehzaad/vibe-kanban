/**
 * Remote configuration
 * Translates: crates/remote/src/config.rs
 */

export interface RemoteConfig {
  databaseUrl: string;
  jwtSecret: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2Bucket?: string;
  githubAppId?: string;
  githubAppPrivateKey?: string;
}

export function loadRemoteConfig(): RemoteConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    jwtSecret: process.env.JWT_SECRET ?? '',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    r2Bucket: process.env.R2_BUCKET,
    githubAppId: process.env.GITHUB_APP_ID,
    githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY
  };
}
