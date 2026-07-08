import { promises as fs } from 'node:fs';
import { AgentTool, resolvePath } from './base.js';
import { ToolDefinition, ToolResult } from '../types.js';

export class EditTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'edit',
    description: 'Modifies the content of an existing file. Replaces a precise block of old text (old_string) with new text (new_string). The old text must match exactly and exist only once in the target file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path of the file to modify (can be absolute or relative to the working directory).'
        },
        old_string: {
          type: 'string',
          description: 'The exact block of code/text to be replaced. Must match indentation and characters exactly.'
        },
        new_string: {
          type: 'string',
          description: 'The new block of code/text to put in place of the old string.'
        }
      },
      required: ['path', 'old_string', 'new_string']
    },
    executionMode: 'sequential',
    promptSnippet: 'edit: Edit an existing file by replacing an exact string'
  };

  async execute(toolCallId: string, args: Record<string, any>, workingDir: string): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const { path, old_string, new_string } = args;
      if (path === undefined || old_string === undefined || new_string === undefined) {
        throw new Error('未提供必填參數 "path", "old_string" 或 "new_string"');
      }

      const safePath = resolvePath(workingDir, path);
      
      let rawContent: string;
      try {
        rawContent = await fs.readFile(safePath, 'utf8');
      } catch (err: any) {
        throw new Error(`讀取要編輯的檔案失敗: ${err.message}`);
      }

      // 計算 old_string 出現的次數
      const occurrences = rawContent.split(old_string).length - 1;

      if (occurrences === 0) {
        throw new Error(`無法在檔案中找到與 "old_string" 完全吻合的文字。請檢查空格、換行與縮排是否完全一致。`);
      } else if (occurrences > 1) {
        throw new Error(`"old_string" 在檔案中匹配到多個地方 (${occurrences} 次)。請提供包含更多前後上下文的 "old_string" 以確保唯一性。`);
      }

      // 替換
      const newContent = rawContent.replace(old_string, new_string);

      // 寫回
      await fs.writeFile(safePath, newContent, 'utf8');

      return {
        toolCallId,
        isError: false,
        content: `成功編輯檔案: ${path} (已完成一次替換)`,
        details: {
          path,
          originalSizeBytes: Buffer.byteLength(rawContent, 'utf8'),
          newSizeBytes: Buffer.byteLength(newContent, 'utf8')
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
