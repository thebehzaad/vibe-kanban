/**
 * MCP Server binary
 * Translates: crates/server/src/bin/mcp_task_server.rs
 *
 * Standalone MCP server for AI agent integration.
 */

import { TaskMcpServer } from '../mcp/task-server.js';

async function main() {
  // TODO: Initialize and start MCP server
  const server = new TaskMcpServer();
  
  console.log('MCP Task Server started');
  console.log('Available tools:', await server.listTools());
  console.log('Available resources:', await server.listResources());
  
  // TODO: Handle stdio communication protocol
}

main().catch(console.error);
