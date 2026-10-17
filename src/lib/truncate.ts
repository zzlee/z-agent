export interface TruncateResult {
  content: string;
  truncated: boolean;
}

/**
 * 依位元組數與行數上限截斷文字輸出，避免單一工具結果撐爆 client 的 context。
 * 位元組截斷以 UTF-8 邊界為準，不會產生壞掉的多位元組字元。
 */
export function truncateContent(content: string, maxLines: number, maxBytes: number): TruncateResult {
  let truncated = false;
  let result = content;

  if (Buffer.byteLength(result, 'utf8') > maxBytes) {
    result = Buffer.from(result, 'utf8').subarray(0, maxBytes).toString('utf8');
    truncated = true;
  }

  const lines = result.split(/\r?\n/);
  if (lines.length > maxLines) {
    result = lines.slice(0, maxLines).join('\n');
    truncated = true;
  }

  if (truncated) {
    result += `\n\n[output truncated: exceeded ${maxLines} lines / ${Math.floor(maxBytes / 1024)} KB]`;
  }

  return { content: result, truncated };
}
