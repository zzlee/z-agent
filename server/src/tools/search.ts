import { promises as fs } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { AgentTool, resolveSafePath } from './base.js';
import { ToolDefinition, ToolResult } from '../types.js';

export class SearchTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'search',
    description: 'Searches for text patterns or regular expressions inside file contents, similar to grep. Excludes node_modules and .git folders.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The keyword or regular expression to search for.'
        },
        path: {
          type: 'string',
          description: 'The directory path to search in (relative to the working directory, optional, defaults to the root).'
        },
        include: {
          type: 'string',
          description: 'File extension filter, e.g. ".ts" or ".json" (optional).'
        }
      },
      required: ['pattern']
    },
    executionMode: 'parallel',
    promptSnippet: 'search: Search for text or regex patterns in files'
  };

  private excludeDirs = new Set(['node_modules', '.git', 'dist', 'build', '.pi']);

  async execute(toolCallId: string, args: Record<string, any>, workingDir: string): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const { pattern, path = '.', include } = args;
      if (!pattern) {
        throw new Error('未提供必填參數 "pattern"');
      }

      const safeSearchDir = resolveSafePath(workingDir, path);
      
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (err: any) {
        throw new Error(`無效的正則表達式: ${err.message}`);
      }

      const matches: Array<{ file: string; line: number; content: string }> = [];
      const maxMatches = 100; // 限制回傳最多 100 個匹配，避免 token 爆炸

      const searchFile = async (filePath: string) => {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          // 簡易排除二進位檔案
          if (content.includes('\u0000')) return;

          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const relPath = relative(workingDir, filePath);
              matches.push({
                file: relPath,
                line: i + 1,
                content: lines[i].trim()
              });
              if (matches.length >= maxMatches) {
                return;
              }
            }
          }
        } catch (e) {}
      };

      const traverse = async (currentDir: string): Promise<void> => {
        let entries: any[];
        try {
          entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch (e) {
          return;
        }

        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (this.excludeDirs.has(entry.name)) {
              continue;
            }
            await traverse(fullPath);
            if (matches.length >= maxMatches) return;
          } else if (entry.isFile()) {
            // 檢查副檔名過濾
            if (include) {
              const ext = extname(entry.name);
              const filter = include.startsWith('.') ? include : `.${include}`;
              if (ext.toLowerCase() !== filter.toLowerCase()) {
                continue;
              }
            }
            await searchFile(fullPath);
            if (matches.length >= maxMatches) return;
          }
        }
      };

      await traverse(safeSearchDir);

      let contentResult = '';
      if (matches.length === 0) {
        contentResult = `搜尋結束，未找到匹配項目: "${pattern}"`;
      } else {
        contentResult = matches
          .map(m => `${m.file}:${m.line}: ${m.content}`)
          .join('\n');
        if (matches.length >= maxMatches) {
          contentResult += `\n\n[系統通知：已達到最大匹配結果上限 (${maxMatches} 項)]`;
        }
      }

      return {
        toolCallId,
        isError: false,
        content: contentResult,
        details: {
          matchCount: matches.length,
          pattern,
          path,
          include
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
