import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolvePath } from '../lib/paths.js';
import { truncateContent } from '../lib/truncate.js';
import { textResult, errorResult, errorMessage } from '../lib/result.js';

const MAX_LINES = 2000;
const MAX_BYTES = 200 * 1024;
const DEFAULT_LIMIT = 2000;

export const readInputSchema = {
  path: z
    .string()
    .describe(
      'Path to the file to read. May be relative to the server working directory or absolute. A leading "~" is expanded to the home directory.'
    ),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('1-indexed line number to start reading from. Defaults to 1.'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum number of lines to read. Defaults to 2000.'),
};

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export async function runRead(args: ReadArgs) {
  const { path, offset = 1, limit = DEFAULT_LIMIT } = args;

  try {
    const safePath = resolvePath(path);

    let raw: string;
    try {
      raw = await readFile(safePath, 'utf8');
    } catch (err) {
      return errorResult(`Failed to read file "${path}": ${errorMessage(err)}`);
    }

    const lines = raw.split(/\r?\n/);
    const startIdx = Math.max(0, offset - 1);

    if (startIdx >= lines.length) {
      return textResult(
        `Offset ${offset} is beyond end of file (${lines.length} lines total).`
      );
    }

    const slice = lines.slice(startIdx, startIdx + limit);
    const numbered = slice
      .map((line, i) => `${startIdx + i + 1}: ${line}`)
      .join('\n');

    const { content } = truncateContent(numbered, MAX_LINES, MAX_BYTES);
    return textResult(content);
  } catch (err) {
    return errorResult(`Failed to read file "${args.path}": ${errorMessage(err)}`);
  }
}

export function registerReadTool(server: McpServer): void {
  server.registerTool(
    'read',
    {
      title: 'Read file',
      description:
        'Read the contents of a file as line-numbered text. For large files, use offset/limit to read a specific range. Paths may be relative to the server working directory or absolute.',
      inputSchema: readInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    runRead
  );
}
