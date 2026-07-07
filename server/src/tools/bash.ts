import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolDefinition, ToolResult } from '../types.js';
import { AgentTool, truncateContent, expandTilde } from './base.js';

export class BashTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'bash',
    description: 'Executes a bash command in the project working directory. The command must be non-interactive (avoid commands waiting for user inputs).',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command string to run.'
        },
        timeout: {
          type: 'number',
          description: 'The timeout in seconds. Defaults to 30, maximum 300.'
        }
      },
      required: ['command']
    },
    executionMode: 'sequential',
    promptSnippet: 'bash: Run a bash command in the working directory'
  };

  private blacklist: string[] = [];
  private shellPath: string;

  constructor(customBlacklist?: string[]) {
    if (customBlacklist) {
      this.blacklist = customBlacklist;
    }
    this.shellPath = BashTool.resolveShellPath();
  }

  static resolveShellPath(): string {
    const absoluteCandidates = ['/bin/bash', '/usr/bin/bash', '/bin/sh'];
    for (const candidate of absoluteCandidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return 'bash';
  }

  async execute(toolCallId: string, args: Record<string, any>, workingDir: string): Promise<ToolResult> {
    const startTime = Date.now();
    const traceId = toolCallId.slice(-12);
    const resolvedCwd = resolve(expandTilde(workingDir));

    try {
      const { command, timeout = 30 } = args;
      if (!command) {
        throw new Error('未提供必填參數 "command"');
      }

      const commandPreview = command.length > 120 ? command.slice(0, 120) + '…' : command;
      console.log(`[BashTool:${traceId}] ▶ cwd: ${resolvedCwd} | shell: ${this.shellPath} | cmd: ${commandPreview}`);

      const isDangerous = this.blacklist.some(b => command.includes(b));
      if (isDangerous) {
        console.warn(`[BashTool:${traceId}] ✗ BLOCKED: ${commandPreview}`);
        throw new Error(`安全性拒絕：偵測到命令包含禁止執行的關鍵字（例如 sudo、rm -rf /、互動編輯器等）。`);
      }

      const resolvedTimeout = Math.min(300, Math.max(1, timeout)) * 1000;
      const outputData: string[] = [];

      const result = await new Promise<{ exitCode: number | null; output: string; err?: string }>((resolvePromise) => {
        const child = spawn(this.shellPath, ['-c', command], {
          cwd: resolvedCwd,
          env: { ...process.env, PAGER: 'cat' },
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let isSettled = false;

        const timer = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            try { child.kill('SIGTERM'); } catch (e) {}
            resolvePromise({ exitCode: null, output: outputData.join(''), err: `執行超時 (限制 ${timeout} 秒)` });
          }
        }, resolvedTimeout);

        child.stdout.on('data', (data) => { outputData.push(data.toString('utf8')); });
        child.stderr.on('data', (data) => { outputData.push(data.toString('utf8')); });

        child.on('error', (err) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            console.error(`[BashTool:${traceId}] ✗ SPAWN ERROR: ${err.message}`);
            resolvePromise({ exitCode: null, output: outputData.join(''), err: err.message });
          }
        });

        child.on('close', (code) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            resolvePromise({ exitCode: code, output: outputData.join('') });
          }
        });
      });

      const elapsed = Date.now() - startTime;

      if (result.err) {
        console.log(`[BashTool:${traceId}] ✗ FAILED (${elapsed}ms): ${result.err}`);
        return {
          toolCallId,
          isError: true,
          content: `命令執行失敗: ${result.err}\n輸出紀錄:\n${result.output}`,
          details: { exitCode: result.exitCode, timeout: result.err.includes('超時') },
          executionTimeMs: elapsed
        };
      }

      const isError = result.exitCode !== 0;
      const maxLines = 1000;
      const maxBytes = 100 * 1024;
      const { content: truncatedContent, truncated } = truncateContent(result.output, maxLines, maxBytes);
      const outputBytes = result.output.length;

      console.log(`[BashTool:${traceId}] ${isError ? '✗' : '✓'} exit=${result.exitCode} ${outputBytes}B ${truncated ? '(truncated) ' : ''}${elapsed}ms`);

      return {
        toolCallId,
        isError,
        content: truncatedContent || '(無輸出內容)',
        details: { exitCode: result.exitCode, truncated },
        executionTimeMs: elapsed
      };
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      console.error(`[BashTool:${traceId}] ✗ ERROR: ${(err as Error).message} (${elapsed}ms)`);
      return {
        toolCallId,
        isError: true,
        content: err.message || '未知錯誤',
        executionTimeMs: elapsed
      };
    }
  }
}
