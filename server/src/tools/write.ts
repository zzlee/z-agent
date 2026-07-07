import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { AgentTool, resolveSafePath } from './base.js';
import { ToolDefinition, ToolResult } from '../types.js';

export class WriteTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'write',
    description: 'Creates a new file or overwrites an existing file. Parent directories will be automatically created if they do not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path of the file to write (relative to the working directory).'
        },
        content: {
          type: 'string',
          description: 'The content to write into the file.'
        }
      },
      required: ['path', 'content']
    },
    executionMode: 'parallel',
    promptSnippet: 'write: Create a new file or overwrite an existing file'
  };

  async execute(toolCallId: string, args: Record<string, any>, workingDir: string): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const { path, content } = args;
      if (path === undefined || content === undefined) {
        throw new Error('未提供必填參數 "path" 或 "content"');
      }

      const safePath = resolveSafePath(workingDir, path);
      const parentDir = dirname(safePath);

      // 自動建立不存在的父目錄
      await fs.mkdir(parentDir, { recursive: true });

      // 寫入檔案
      await fs.writeFile(safePath, content, 'utf8');
      
      const bytesWritten = Buffer.byteLength(content, 'utf8');

      return {
        toolCallId,
        isError: false,
        content: `成功寫入檔案: ${path} (大小: ${bytesWritten} 位元組)`,
        details: {
          path,
          bytesWritten
        },
        executionTimeMs: Date.now() - startTime
      };
    } catch (err: any) {
      return {
        toolCallId,
        isError: true,
        content: err.message || '未知錯誤',
        executionTimeMs: Date.now() - startTime
      };
    }
  }
}
