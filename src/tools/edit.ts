import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolvePath } from '../lib/paths.js';
import { textResult, errorResult, errorMessage } from '../lib/result.js';

export const editInputSchema = {
  path: z
    .string()
    .describe(
      'Path to the file to edit. May be relative to the server working directory or absolute. A leading "~" is expanded to the home directory.'
    ),
  oldText: z
    .string()
    .describe(
      'The exact text to find. Must match the file byte-for-byte, including exact whitespace and indentation, and must occur exactly once. Do NOT include the "<line>: " prefixes produced by the "read" tool.'
    ),
  newText: z
    .string()
    .describe(
      'The text to replace oldText with. Pass an empty string ("") to delete oldText from the file.'
    ),
};

export interface EditArgs {
  path: string;
  oldText: string;
  newText: string;
}

export async function runEdit(args: EditArgs) {
  const { path, oldText, newText } = args;

  try {
    if (oldText === newText) {
      return errorResult('oldText and newText are identical; nothing to change.');
    }

    const safePath = resolvePath(path);

    let content: string;
    try {
      content = await readFile(safePath, 'utf8');
    } catch (err) {
      return errorResult(`Failed to edit file "${path}": ${errorMessage(err)}`);
    }

    const parts = content.split(oldText);

    if (parts.length === 1) {
      return errorResult(
        `Could not find the exact oldText in "${path}". Make sure it matches including whitespace and indentation.`
      );
    }
    if (parts.length > 2) {
      return errorResult(
        `oldText matched ${parts.length - 1} times in "${path}". It must match exactly once; include more surrounding context to make it unique.`
      );
    }

    await writeFile(safePath, parts.join(newText), 'utf8');
    return textResult(`Successfully edited ${safePath}`);
  } catch (err) {
    return errorResult(`Failed to edit file "${path}": ${errorMessage(err)}`);
  }
}

export function registerEditTool(server: McpServer): void {
  server.registerTool(
    'edit',
    {
      title: 'Edit file',
      description:
        'Replace an exact unique string in a file with new text. oldText must match byte-for-byte (excluding any line-number prefixes from the "read" tool) and occur exactly once; if it is ambiguous, include more surrounding lines to make it unique. Pass newText="" to delete code. Use this for precise, surgical edits instead of rewriting whole files.',
      inputSchema: editInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    runEdit
  );
}
