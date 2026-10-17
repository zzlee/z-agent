import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * 建構成功的工具回應。
 */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * 建構失敗的工具回應（標記 isError，讓 client 端模型知道呼叫失敗）。
 */
export function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * 將任意錯誤轉為可讀字串。
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
