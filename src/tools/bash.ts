import { z } from 'zod';
import { spawn } from 'node:child_process';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveShellPath } from '../lib/shell.js';
import { truncateContent } from '../lib/truncate.js';
import { textResult, errorResult, errorMessage } from '../lib/result.js';

const DEFAULT_TIMEOUT_SEC = 120;
const MAX_TIMEOUT_SEC = 600;
const MAX_LINES = 100_000;
const MAX_BYTES = 100 * 1024;

export const bashInputSchema = {
  command: z
    .string()
    .describe(
      'The shell command to execute. It runs via `bash -c` in the server working directory and must be non-interactive (avoid commands that wait for input).'
    ),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(MAX_TIMEOUT_SEC)
    .optional()
    .describe(
      `Timeout in seconds. Defaults to ${DEFAULT_TIMEOUT_SEC}, maximum ${MAX_TIMEOUT_SEC}.`
    ),
};

export interface BashArgs {
  command: string;
  timeout?: number;
}

interface BashOutcome {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  spawnError?: string;
}

function executeCommand(command: string, timeoutSec: number, cwd: string): Promise<BashOutcome> {
  return new Promise((resolve) => {
    const shell = resolveShellPath();
    const child = spawn(shell, ['-c', command], {
      cwd,
      env: { ...process.env, PAGER: 'cat' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: string[] = [];
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 2000).unref();
    }, timeoutSec * 1000);

    const settle = (outcome: BashOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.stdout.on('data', (data: Buffer) => chunks.push(data.toString('utf8')));
    child.stderr.on('data', (data: Buffer) => chunks.push(data.toString('utf8')));

    child.on('error', (err: Error) => {
      settle({ exitCode: null, output: chunks.join(''), timedOut, spawnError: err.message });
    });

    child.on('close', (code: number | null) => {
      settle({ exitCode: code, output: chunks.join(''), timedOut });
    });
  });
}

export async function runBash(args: BashArgs) {
  const { command, timeout = DEFAULT_TIMEOUT_SEC } = args;
  const cwd = process.cwd();

  try {
    const outcome = await executeCommand(command, timeout, cwd);
    const { content } = truncateContent(outcome.output, MAX_LINES, MAX_BYTES);
    const body = content.length > 0 ? content : '(no output)';

    if (outcome.spawnError) {
      return errorResult(`Failed to spawn shell: ${outcome.spawnError}\n${body}`);
    }
    if (outcome.timedOut) {
      return errorResult(
        `Command timed out after ${timeout}s.\nExit code: ${outcome.exitCode ?? 'unknown'}\n${body}`
      );
    }

    const header = `Exit code: ${outcome.exitCode}`;
    if (outcome.exitCode !== 0) {
      return errorResult(`${header}\n${body}`);
    }
    return textResult(`${header}\n${body}`);
  } catch (err) {
    return errorResult(`Failed to execute command: ${errorMessage(err)}`);
  }
}

export function registerBashTool(server: McpServer): void {
  server.registerTool(
    'bash',
    {
      title: 'Run bash command',
      description:
        'Execute a bash command in the server working directory and return its combined stdout/stderr together with the exit code. Use it for file operations such as ls, grep, find, git, etc. Commands must be non-interactive.',
      inputSchema: bashInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    runBash
  );
}
