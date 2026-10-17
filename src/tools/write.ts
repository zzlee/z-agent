import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolvePath } from '../lib/paths.js';
import { textResult, errorResult, errorMessage } from '../lib/result.js';

export const writeInputSchema = {
  path: z
    .string()
    .describe(
      'Path to the file to write. May be relative to the server working directory or absolute. A leading "~" is expanded to the home directory.'
    ),
  content: z.string().describe('The full content to write to the file.'),
};

export interface WriteArgs {
  path: string;
  content: string;
}

export async function runWrite(args: WriteArgs) {
  const { path, content } = args;

  try {
    const safePath = resolvePath(path);
    await mkdir(dirname(safePath), { recursive: true });
    await writeFile(safePath, content, 'utf8');

    const bytes = Buffer.byteLength(content, 'utf8');
    return textResult(`Successfully wrote ${bytes} bytes to ${safePath}`);
  } catch (err) {
    return errorResult(`Failed to write file "${path}": ${errorMessage(err)}`);
  }
}

export function registerWriteTool(server: McpServer): void {
  server.registerTool(
    'write',
    {
      title: 'Write file',
      description:
        'Create a new file or overwrite an existing file with the given content. Parent directories are created automatically if they do not exist.',
      inputSchema: writeInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    runWrite
  );
}
