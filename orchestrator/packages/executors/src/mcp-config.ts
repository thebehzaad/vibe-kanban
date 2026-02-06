/**
 * MCP configuration
 * Translates: crates/executors/src/mcp_config.rs
 *
 * Model Context Protocol configuration for executors.
 */

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export function loadMcpConfig(path: string): McpConfig {
  // TODO: Implement MCP config loading
  throw new Error('Not implemented');
}

export function saveMcpConfig(path: string, config: McpConfig): void {
  // TODO: Implement MCP config saving
  throw new Error('Not implemented');
}
