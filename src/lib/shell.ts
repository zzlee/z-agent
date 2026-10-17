import { existsSync } from 'node:fs';

const POSIX_CANDIDATES = ['/bin/bash', '/usr/bin/bash', '/bin/sh'];

/**
 * 選擇用來執行 bash 工具的 shell。
 * 在 POSIX 系統上優先使用絕對路徑的 bash，找不到時退回 PATH 查找。
 */
export function resolveShellPath(): string {
  if (process.platform === 'win32') {
    return 'bash.exe';
  }
  for (const candidate of POSIX_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'bash';
}
