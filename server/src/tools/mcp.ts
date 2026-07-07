import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolDefinition, ToolResult } from '../types.js';
import { AgentTool } from './base.js';

export class McpTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'mcp',
    description: 'Execute Model Context Protocol (MCP) server tools or list available tools on an MCP server. Spawns an MCP server via stdio, connects, performs the action, and then shuts down the server.',
    parameters: {
      type: 'object',
      properties: {
        serverCommand: {
          type: 'string',
          description: 'The command to start the MCP server (e.g., "node", "npx", "python").'
        },
        serverArgs: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Arguments to pass to the server command (e.g., ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]).'
        },
        action: {
          type: 'string',
          enum: ['list_tools', 'call_tool'],
          description: 'The action to perform: "list_tools" to list available tools, or "call_tool" to execute a specific tool.'
        },
        toolName: {
          type: 'string',
          description: 'The name of the tool to call. Required if action is "call_tool".'
        },
        toolArgs: {
          type: 'object',
          description: 'The arguments to pass to the tool. Optional, used if action is "call_tool".'
        }
      },
      required: ['serverCommand', 'serverArgs', 'action']
    },
    executionMode: 'sequential',
    promptSnippet: 'mcp: Execute Model Context Protocol (MCP) tools or list them'
  };

  async execute(toolCallId: string, args: Record<string, any>, workingDir: string): Promise<ToolResult> {
    const startTime = Date.now();
    const traceId = toolCallId.slice(-12);

    try {
      const { serverCommand, serverArgs, action, toolName, toolArgs } = args;

      if (!serverCommand || !serverArgs || !action) {
        throw new Error('Missing required parameters: serverCommand, serverArgs, or action');
      }

      console.log(`[McpTool:${traceId}] ▶ Spawning MCP server: ${serverCommand} ${serverArgs.join(' ')}`);

      let transport: StdioClientTransport | null = null;
      let resultString = '';

      try {
        transport = new StdioClientTransport({
          command: serverCommand,
          args: serverArgs,
          env: Object.fromEntries(
            Object.entries(process.env).filter(([_, v]) => v !== undefined)
          ) as Record<string, string>
        });

        const client = new Client(
          {
            name: 'z-agent-mcp-client',
            version: '1.0.0',
          },
          {
            capabilities: {}
          }
        );

        await client.connect(transport);
        console.log(`[McpTool:${traceId}] Connected to MCP server.`);

        if (action === 'list_tools') {
          const response = await client.listTools();
          resultString = JSON.stringify(response.tools, null, 2);
        } else if (action === 'call_tool') {
          if (!toolName) {
            throw new Error('toolName is required when action is "call_tool"');
          }
          const response = await client.callTool({
            name: toolName,
            arguments: toolArgs || {}
          });

          if (response.isError) {
            resultString = `Tool returned error:\n${JSON.stringify(response.content, null, 2)}`;
            throw new Error(resultString);
          } else {
             // Standardize text output if it's text content
             const contentArr = response.content as Array<{ type: string; text?: string }>;
             const contents = contentArr.map((c) => {
               if (c.type === 'text') {
                 return c.text;
               }
               return JSON.stringify(c);
             });
             resultString = contents.join('\n');
          }
        } else {
          throw new Error(`Unknown action: ${action}`);
        }
      } finally {
        if (transport) {
          try {
            await transport.close();
          } catch (e) {}
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`[McpTool:${traceId}] ✓ action=${action} ${elapsed}ms`);

      return {
        toolCallId,
        isError: false,
        content: resultString || 'Success (no output)',
        executionTimeMs: elapsed
      };

    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      console.error(`[McpTool:${traceId}] ✗ ERROR: ${err.message} (${elapsed}ms)`);
      return {
        toolCallId,
        isError: true,
        content: err.message || 'Unknown error occurred while interacting with MCP server',
        executionTimeMs: elapsed
      };
    }
  }
}
