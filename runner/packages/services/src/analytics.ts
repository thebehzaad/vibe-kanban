/**
 * Analytics service
 * Translates: crates/services/src/services/analytics.rs
 *
 * PostHog analytics with platform-specific anonymous user ID generation.
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import * as os from 'node:os';

// ── Config ──

export interface AnalyticsConfig {
  posthogApiKey: string;
  posthogApiEndpoint: string;
}

export function createAnalyticsConfig(): AnalyticsConfig | null {
  const apiKey = process.env.POSTHOG_API_KEY;
  const apiEndpoint = process.env.POSTHOG_API_ENDPOINT;

  if (!apiKey || !apiEndpoint) {
    return null;
  }

  return { posthogApiKey: apiKey, posthogApiEndpoint: apiEndpoint };
}

// ── Context ──

export interface AnalyticsContext {
  userId: string;
  analyticsService: AnalyticsService;
}

// ── Service ──

export class AnalyticsService {
  private config: AnalyticsConfig;

  constructor(config: AnalyticsConfig) {
    this.config = config;
  }

  trackEvent(
    userId: string,
    eventName: string,
    properties?: Record<string, unknown>,
  ): void {
    const endpoint = `${this.config.posthogApiEndpoint.replace(/\/+$/, '')}/capture/`;

    let payload: Record<string, unknown>;

    if (eventName === '$identify') {
      // For $identify, set person properties in $set
      payload = {
        api_key: this.config.posthogApiKey,
        event: eventName,
        distinct_id: userId,
        ...(properties ? { $set: properties } : {}),
      };
    } else {
      // For other events, use properties as before
      const eventProperties: Record<string, unknown> = {
        ...properties,
        timestamp: new Date().toISOString(),
        device: getDeviceInfo(),
        source: 'backend',
      };

      payload = {
        api_key: this.config.posthogApiKey,
        event: eventName,
        distinct_id: userId,
        properties: eventProperties,
      };
    }

    // Fire-and-forget HTTP POST (matches Rust's tokio::spawn)
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
      .then((response) => {
        if (response.ok) {
          console.debug(`Event '${eventName}' sent successfully`);
        } else {
          response.text().then((text) => {
            console.error(
              `Failed to send event. Status: ${response.status}. Response: ${text}`,
            );
          }).catch(() => {
            console.error(`Failed to send event. Status: ${response.status}`);
          });
        }
      })
      .catch((err) => {
        console.error(`Error sending event '${eventName}': ${err}`);
      });
  }
}

// ── User ID generation ──

/**
 * Generates a consistent, anonymous user ID for telemetry.
 * Returns a hex string prefixed with "npm_user_"
 */
export function generateUserId(): string {
  const hash = createHash('md5');

  if (process.platform === 'darwin') {
    // Use ioreg to get hardware UUID
    try {
      const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const line = output.split('\n').find((l) => l.includes('IOPlatformUUID'));
      if (line) {
        hash.update(line);
      }
    } catch {
      // ignore
    }
  } else if (process.platform === 'linux') {
    try {
      const machineId = require('node:fs').readFileSync('/etc/machine-id', 'utf-8');
      hash.update(machineId.trim());
    } catch {
      // ignore
    }
  } else if (process.platform === 'win32') {
    // Use PowerShell to get machine GUID from registry
    try {
      const output = execSync(
        `powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid"`,
        { encoding: 'utf-8', timeout: 5000 },
      );
      if (output.trim()) {
        hash.update(output);
      }
    } catch {
      // ignore
    }
  }

  // Add username for per-user differentiation
  const user = process.env.USER || process.env.USERNAME;
  if (user) {
    hash.update(user);
  }

  // Add home directory for additional entropy
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    hash.update(home);
  }

  return `npm_user_${hash.digest('hex').substring(0, 16)}`;
}

// ── Device info ──

function getDeviceInfo(): Record<string, string> {
  return {
    os_type: os.type(),
    os_version: os.release(),
    architecture: os.arch(),
    bitness: process.arch.includes('64') ? '64' : '32',
  };
}
