import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadTool } from './tools/read.js';
import { registerWriteTool } from './tools/write.js';
import { registerEditTool } from './tools/edit.js';
import { registerBashTool } from './tools/bash.js';

export const SERVER_NAME = 'z-agent';
export const SERVER_TITLE = 'z-agent';
export const SERVER_VERSION = '2.0.0';

/**
 * 建立並回傳一個已註冊 bash/read/write/edit 四工具的 MCP server。
 * 抽成 factory 以便測試（可用 InMemoryTransport 直接連線）。
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    title: SERVER_TITLE,
    version: SERVER_VERSION,
  });

  registerReadTool(server);
  registerWriteTool(server);
  registerEditTool(server);
  registerBashTool(server);

  return server;
}
