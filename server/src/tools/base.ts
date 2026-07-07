import { resolve, relative, isAbsolute } from 'node:path';
import { ToolDefinition, ToolResult } from '../types.js';

export interface AgentTool {
  definition: ToolDefinition;
  execute(toolCallId: string, args: Record<string, any>, workingDir: string): Promise<ToolResult>;
}

/**
 * 確保目標路徑在工作目錄內，防止目錄穿越攻擊
 */
export function resolveSafePath(workingDir: string, targetPath: string): string {
  const absoluteWorkingDir = resolve(workingDir);
  const absoluteTargetPath = isAbsolute(targetPath) 
    ? resolve(targetPath) 
    : resolve(workingDir, targetPath);

  const relativePath = relative(absoluteWorkingDir, absoluteTargetPath);
  
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`存取拒絕：路徑 "${targetPath}" 超出工作目錄 "${workingDir}" 的範圍。`);
  }
  
  return absoluteTargetPath;
}

/**
 * 截斷長文字輸出
 */
export function truncateContent(content: string, maxLines: number, maxBytes: number): { content: string; truncated: boolean } {
  let truncated = false;
  let result = content;

  // 檢查位元組數
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > maxBytes) {
    result = content.slice(0, maxBytes);
    truncated = true;
  }

  // 檢查行數
  const lines = result.split(/\r?\n/);
  if (lines.length > maxLines) {
    result = lines.slice(0, maxLines).join('\n');
    truncated = true;
  }

  if (truncated) {
    result += `\n\n[系統通知：內容因超出上限已被截斷 (${maxLines} 行 / ${maxBytes / 1024} KB)]`;
  }

  return { content: result, truncated };
}
