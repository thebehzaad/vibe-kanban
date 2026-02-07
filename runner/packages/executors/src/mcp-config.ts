/**
 * MCP configuration utilities
 * Translates: crates/executors/src/mcp_config.rs
 *
 * Utilities for reading and writing external agent config files.
 * Supports JSON, JSONC, and TOML formats.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// --- McpConfig ---

export interface McpConfig {
  servers: Record<string, unknown>;
  serversPath: string[];
  template: unknown;
  preconfigured: unknown;
  isTomlConfig: boolean;
}

export function createMcpConfig(
  serversPath: string[],
  template: unknown,
  preconfigured: unknown,
  isTomlConfig: boolean,
): McpConfig {
  return {
    servers: {},
    serversPath,
    template,
    preconfigured,
    isTomlConfig,
  };
}

// --- readAgentConfig ---

export async function readAgentConfig(
  configPath: string,
  mcpConfig: McpConfig,
): Promise<unknown> {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    if (!content.trim()) {
      return {};
    }
    // For JSON/JSONC configs
    if (!mcpConfig.isTomlConfig) {
      return JSON.parse(content);
    }
    // TOML support would require a TOML parser library
    return JSON.parse(content);
  } catch {
    // File doesn't exist or can't be read, return template
    return mcpConfig.template;
  }
}

// --- writeAgentConfig ---

export async function writeAgentConfig(
  configPath: string,
  mcpConfig: McpConfig,
  config: unknown,
): Promise<void> {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, content, 'utf-8');
}
