import { spawn } from 'node:child_process';
import { AgentTool, truncateContent } from './base.js';
import { ToolDefinition, ToolResult } from '../types.js';

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

  private blacklist: string[] = ['sudo', 'su', 'rm -rf /', 'nano', 'vim', 'vi'];

  constructor(customBlacklist?: string[]) {
    if (customBlacklist) {
      this.blacklist = customBlacklist;
    }
  }

  async execute(toolCallId: string, args: Record<string, any>, workingDir: string): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const { command, timeout = 30 } = args;
      if (!command) {
        throw new Error('未提供必填參數 "command"');
      }

      // 安全性檢查：阻擋黑名單中的危險或互動式命令
      const isDangerous = this.blacklist.some(b => command.includes(b));
      if (isDangerous) {
        throw new Error(`安全性拒絕：偵測到命令包含禁止執行的關鍵字（例如 sudo、rm -rf /、互動編輯器等）。`);
      }

      // 檢查超時時間範圍
      const resolvedTimeout = Math.min(300, Math.max(1, timeout)) * 1000;

      const outputData: string[] = [];

      const result = await new Promise<{ exitCode: number | null; output: string; err?: string }>((resolvePromise) => {
        // 使用 bash -c 執行命令
        const child = spawn('bash', ['-c', command], {
          cwd: workingDir,
          env: { ...process.env, PAGER: 'cat' }, // 強制 PAGER=cat 避免分頁掛起
          stdio: ['ignore', 'pipe', 'pipe'] // 不輸入 stdin
        });

        let isSettled = false;

        const timer = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            try {
              child.kill('SIGTERM');
            } catch (e) {}
            resolvePromise({
              exitCode: null,
              output: outputData.join(''),
              err: `執行超時 (限制 ${timeout} 秒)`
            });
          }
        }, resolvedTimeout);

        child.stdout.on('data', (data) => {
          outputData.push(data.toString('utf8'));
        });

        child.stderr.on('data', (data) => {
          outputData.push(data.toString('utf8'));
        });

        child.on('error', (err) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            resolvePromise({
              exitCode: null,
              output: outputData.join(''),
              err: err.message
            });
          }
        });

        child.on('close', (code) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            resolvePromise({
              exitCode: code,
              output: outputData.join('')
            });
          }
        });
      });

      if (result.err) {
        return {
          toolCallId,
          isError: true,
          content: `命令執行失敗: ${result.err}\n輸出紀錄:\n${result.output}`,
          details: {
            exitCode: result.exitCode,
            timeout: true
          },
          executionTimeMs: Date.now() - startTime
        };
      }

      const isError = result.exitCode !== 0;
      
      // 進行輸出限制 (最大 1000 行 / 100KB)
      const maxLines = 1000;
      const maxBytes = 100 * 1024;
      const { content: truncatedContent, truncated } = truncateContent(result.output, maxLines, maxBytes);

      return {
        toolCallId,
        isError,
        content: truncatedContent || '(無輸出內容)',
        details: {
          exitCode: result.exitCode,
          truncated
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
