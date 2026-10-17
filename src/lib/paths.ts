import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

/**
 * 展開路徑開頭的 `~` 為使用者家目錄。
 */
export function expandTilde(p: string): string {
  if (p === '~') {
    return homedir();
  }
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return homedir() + p.slice(1);
  }
  return p;
}

/**
 * 將使用者提供的路徑解析為絕對路徑。
 * 絕對路徑原樣正規化;相對路徑則以 `cwd`（預設為 server 程序的工作目錄）為基準。
 */
export function resolvePath(target: string, cwd: string = process.cwd()): string {
  const expandedTarget = expandTilde(target);
  const expandedCwd = expandTilde(cwd);
  return isAbsolute(expandedTarget)
    ? resolve(expandedTarget)
    : resolve(expandedCwd, expandedTarget);
}
