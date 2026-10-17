import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runRead } from '../tools/read.js';
import { runWrite } from '../tools/write.js';
import { runEdit } from '../tools/edit.js';
import { runBash } from '../tools/bash.js';

let testDir: string;
let cwdSpy: string;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'zagent-mcp-test-'));
  cwdSpy = process.cwd();
  process.chdir(testDir);
});

afterAll(async () => {
  process.chdir(cwdSpy);
  await fs.rm(testDir, { recursive: true, force: true });
});

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? '').join('\n');
}

// ─────────────────────────── read ───────────────────────────
describe('read', () => {
  it('reads a whole file with line numbers', async () => {
    await fs.writeFile(join(testDir, 'a.txt'), 'one\ntwo\nthree', 'utf8');
    const res = await runRead({ path: 'a.txt' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('1: one');
    expect(textOf(res)).toContain('3: three');
  });

  it('supports offset and limit', async () => {
    const res = await runRead({ path: 'a.txt', offset: 2, limit: 1 });
    const text = textOf(res);
    expect(text).toContain('2: two');
    expect(text).not.toContain('1: one');
    expect(text).not.toContain('3: three');
  });

  it('reports when offset is beyond end of file', async () => {
    const res = await runRead({ path: 'a.txt', offset: 99 });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('beyond end of file');
  });

  it('errors on missing file', async () => {
    const res = await runRead({ path: 'nope.txt' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('Failed to read file');
  });
});

// ─────────────────────────── write ──────────────────────────
describe('write', () => {
  it('creates a new file and parent directories', async () => {
    const res = await runWrite({ path: 'deep/nested/b.txt', content: 'hello' });
    expect(res.isError).toBeFalsy();
    const content = await fs.readFile(join(testDir, 'deep/nested/b.txt'), 'utf8');
    expect(content).toBe('hello');
  });

  it('overwrites an existing file', async () => {
    await runWrite({ path: 'b.txt', content: 'first' });
    await runWrite({ path: 'b.txt', content: 'second' });
    const content = await fs.readFile(join(testDir, 'b.txt'), 'utf8');
    expect(content).toBe('second');
  });
});

// ─────────────────────────── edit ───────────────────────────
describe('edit', () => {
  it('replaces a unique exact string', async () => {
    await fs.writeFile(join(testDir, 'edit.txt'), 'alpha\nbeta\ngamma', 'utf8');
    const res = await runEdit({ path: 'edit.txt', oldText: 'beta', newText: 'BETA' });
    expect(res.isError).toBeFalsy();
    expect(await fs.readFile(join(testDir, 'edit.txt'), 'utf8')).toBe('alpha\nBETA\ngamma');
  });

  it('errors when oldText is not found', async () => {
    const res = await runEdit({ path: 'edit.txt', oldText: 'missing', newText: 'x' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('Could not find');
  });

  it('errors when oldText matches more than once', async () => {
    await fs.writeFile(join(testDir, 'dup.txt'), 'foo\nbar\nfoo', 'utf8');
    const res = await runEdit({ path: 'dup.txt', oldText: 'foo', newText: 'FOO' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('matched 2 times');
  });

  it('errors when oldText equals newText', async () => {
    const res = await runEdit({ path: 'edit.txt', oldText: 'same', newText: 'same' });
    expect(res.isError).toBe(true);
  });
});

// ─────────────────────────── bash ───────────────────────────
describe('bash', () => {
  it('runs a command and returns output with exit code 0', async () => {
    const res = await runBash({ command: 'echo hello-from-bash' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('hello-from-bash');
    expect(textOf(res)).toContain('Exit code: 0');
  });

  it('runs in the server working directory', async () => {
    const res = await runBash({ command: 'pwd' });
    expect(textOf(res)).toContain(testDir);
  });

  it('marks non-zero exit as an error', async () => {
    const res = await runBash({ command: 'exit 42' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('Exit code: 42');
  });

  it('times out long-running commands', async () => {
    const res = await runBash({ command: 'sleep 5', timeout: 1 });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('timed out');
  }, 10000);

  it('captures stderr', async () => {
    const res = await runBash({ command: 'echo oops 1>&2' });
    expect(textOf(res)).toContain('oops');
  });
});
