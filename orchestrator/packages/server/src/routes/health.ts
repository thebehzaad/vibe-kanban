/**
 * Health check routes
 * Translates: crates/server/src/routes/health.rs
 */

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
}

export function healthCheck(): HealthResponse {
  return {
    status: 'ok',
    version: '0.0.1',
    uptime: process.uptime()
  };
}
