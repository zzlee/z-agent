import { promises as fs } from 'node:fs';
import { AgentTool, resolvePath, truncateContent } from './base.js';
import { ToolDefinition, ToolResult } from '../types.js';

export class ReadTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'read',
    description: 'Reads the content of a specified file. Supports reading a specific range of lines, and outputs text with line numbers for reference.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path of the file to read (can be absolute or relative to the working directory).'
        },
        offset: {
          type: 'number',
          description: 'The starting line number (1-indexed, optional).'
        },
        limit: {
          type: 'number',
          description: 'The maximum number of lines to read (optional).'
        }
      },
      required: ['path']
    },
    executionMode: 'parallel',
    promptSnippet: 'read: Read a file with optional line ranges'
  };

  async execute(toolCallId: string, args: Record<string, any>, workingDir: string): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const { path, offset = 1, limit } = args;
      if (!path) {
        throw new Error('未提供必填參數 "path"');
      }

      const safePath = resolvePath(workingDir, path);
      
      let rawContent: string;
      try {
        rawContent = await fs.readFile(safePath, 'utf8');
      } catch (err: any) {
        throw new Error(`讀取檔案失敗: ${err.message}`);
      }

      const lines = rawContent.split(/\r?\n/);
      const startIdx = Math.max(0, offset - 1);
      
      if (startIdx >= lines.length) {
        return {
          toolCallId,
          isError: false,
          content: `Offset ${offset} is beyond end of file (${lines.length} lines total)`,
          details: { linesRead: 0, totalLines: lines.length, offset, limit },
          executionTimeMs: Date.now() - startTime
        };
      }
      
      const endIdx = limit !== undefined ? startIdx + limit : lines.length;
      const sliceLines = lines.slice(startIdx, endIdx);
      
      // 加上行號標記方便編輯與對照
      const formattedLines = sliceLines.map((line, index) => {
        const lineNum = startIdx + index + 1;
        return `${lineNum}: ${line}`;
      });

      const formattedContent = formattedLines.join('\n');
      
      // 進行檔案輸出截斷保護，最大 2000 行，200KB
      const maxLines = 2000;
      const maxBytes = 200 * 1024;
      const { content: truncatedResult, truncated } = truncateContent(formattedContent, maxLines, maxBytes);

      return {
        toolCallId,
        isError: false,
        content: truncatedResult,
        details: {
          linesRead: sliceLines.length,
          totalLines: lines.length,
          truncated,
          offset,
          limit
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
