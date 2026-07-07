import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { ReadTool } from '../tools/read.js';
import { WriteTool } from '../tools/write.js';
import { EditTool } from '../tools/edit.js';
import { BashTool } from '../tools/bash.js';

let testDir: string;
let toolCallId: string;

// ─── 測試前的準備：建立暫存目錄與初始檔案 ──────────────
beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'zagent-tools-test-'));
  toolCallId = 'test_call_001';

  // 建立一些測試檔案
  await fs.writeFile(join(testDir, 'hello.txt'), 'Hello World\nThis is a test file.\nLine 3 content.\nLine 4 here.\nGoodbye!', 'utf8');
  await fs.writeFile(join(testDir, 'config.json'), JSON.stringify({ name: 'test', version: '1.0.0', description: 'A test config' }, null, 2), 'utf8');
  await fs.mkdir(join(testDir, 'nested'), { recursive: true });
  await fs.writeFile(join(testDir, 'nested', 'data.ts'), 'export const x = 42;\nexport const y = "hello";\n', 'utf8');
});

afterAll(async () => {
  // 清理暫存目錄
  await fs.rm(testDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════
// read 工具測試
// ═══════════════════════════════════════════════════════════
describe('ReadTool', () => {
  const tool = new ReadTool();

  it('應該能讀取整個檔案', async () => {
    const result = await tool.execute(toolCallId + '_read1', { path: 'hello.txt' }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Hello World');
    expect(result.content).toContain('Goodbye!');
    expect(result.details?.linesRead).toBe(5);
  });

  it('應該能讀取檔案指定行號範圍（offset + limit）', async () => {
    const result = await tool.execute(toolCallId + '_read2', { path: 'hello.txt', offset: 2, limit: 2 }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('2: This is a test file.');
    expect(result.content).toContain('3: Line 3 content.');
    expect(result.content).not.toContain('Hello World');
    expect(result.details?.linesRead).toBe(2);
  });

  it('讀取不存在的檔案應該回傳錯誤', async () => {
    const result = await tool.execute(toolCallId + '_read3', { path: 'non-existent.txt' }, testDir);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('讀取檔案失敗');
  });

  it('路徑穿越攻擊應該被拒絕', async () => {
    const result = await tool.execute(toolCallId + '_read4', { path: '../../etc/passwd' }, testDir);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('存取拒絕');
  });

  it('缺少 path 參數應該回傳錯誤', async () => {
    const result = await tool.execute(toolCallId + '_read5', {}, testDir);
    expect(result.isError).toBe(true);
  });

  it('應該能讀取 JSON 檔案', async () => {
    const result = await tool.execute(toolCallId + '_read6', { path: 'config.json' }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('"name": "test"');
    expect(result.details?.totalLines).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// write 工具測試
// ═══════════════════════════════════════════════════════════
describe('WriteTool', () => {
  const tool = new WriteTool();

  it('應該能建立新檔案', async () => {
    const result = await tool.execute(toolCallId + '_w1', { path: 'newfile.txt', content: 'Created by test.' }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('成功寫入');
    const content = await fs.readFile(join(testDir, 'newfile.txt'), 'utf8');
    expect(content).toBe('Created by test.');
  });

  it('應該能覆蓋已存在的檔案', async () => {
    const result = await tool.execute(toolCallId + '_w2', { path: 'newfile.txt', content: 'Overwritten content.' }, testDir);
    expect(result.isError).toBe(false);
    const content = await fs.readFile(join(testDir, 'newfile.txt'), 'utf8');
    expect(content).toBe('Overwritten content.');
  });

  it('應該能自動建立不存在的父目錄', async () => {
    const result = await tool.execute(toolCallId + '_w3', { path: 'deep/nested/subdir/file.txt', content: 'Auto-created dirs.' }, testDir);
    expect(result.isError).toBe(false);
    const exists = await fs.access(join(testDir, 'deep', 'nested', 'subdir', 'file.txt')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('缺少 content 參數應該回傳錯誤', async () => {
    const result = await tool.execute(toolCallId + '_w4', { path: 'no-content.txt' }, testDir);
    expect(result.isError).toBe(true);
  });

  it('缺少 path 參數應該回傳錯誤', async () => {
    const result = await tool.execute(toolCallId + '_w5', { content: 'no path' }, testDir);
    expect(result.isError).toBe(true);
  });

  it('路徑穿越攻擊應該被拒絕', async () => {
    const result = await tool.execute(toolCallId + '_w6', { path: '../../outside.txt', content: 'hack' }, testDir);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('存取拒絕');
  });
});

// ═══════════════════════════════════════════════════════════
// edit 工具測試
// ═══════════════════════════════════════════════════════════
describe('EditTool', () => {
  const tool = new EditTool();

  beforeAll(async () => {
    // 準備一個編輯測試用的檔案
    await fs.writeFile(join(testDir, 'edit-test.txt'), 'Line one\nLine two\nLine three\nLine four\n', 'utf8');
  });

  it('應該能精確替換檔案中的文字', async () => {
    const result = await tool.execute(toolCallId + '_e1', {
      path: 'edit-test.txt',
      old_string: 'Line two',
      new_string: 'Line TWO (edited)'
    }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('成功編輯');

    const content = await fs.readFile(join(testDir, 'edit-test.txt'), 'utf8');
    expect(content).toContain('Line TWO (edited)');
    expect(content).not.toContain('Line two\n'); // 原來的被替換了
  });

  it('當 old_string 不存在時應該回傳錯誤', async () => {
    const result = await tool.execute(toolCallId + '_e2', {
      path: 'edit-test.txt',
      old_string: 'Non-existent string',
      new_string: 'replacement'
    }, testDir);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('無法在檔案中找到');
  });

  it('當 old_string 多次出現時應該回傳錯誤', async () => {
    // 先寫入包含多次相同字串的內容
    await fs.writeFile(join(testDir, 'duplicate-test.txt'), 'foo\nbar\nfoo\nbaz\n', 'utf8');
    const result = await tool.execute(toolCallId + '_e3', {
      path: 'duplicate-test.txt',
      old_string: 'foo',
      new_string: 'FOO'
    }, testDir);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('匹配到多個地方');
  });

  it('缺少參數時應該回傳錯誤', async () => {
    const result = await tool.execute(toolCallId + '_e4', { path: 'edit-test.txt' }, testDir);
    expect(result.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// bash 工具測試
// ═══════════════════════════════════════════════════════════
describe('BashTool', () => {
  const tool = new BashTool();

  it('應該能執行簡單的命令並回傳輸出', async () => {
    const result = await tool.execute(toolCallId + '_b1', { command: 'echo "hello from bash"' }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('hello from bash');
    expect(result.details?.exitCode).toBe(0);
  });

  it('應該能執行 pwd 並回傳正確的工作目錄', async () => {
    const result = await tool.execute(toolCallId + '_b2', { command: 'pwd' }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content).toContain(testDir);
  });

  it('ls 應該列出工作目錄的檔案', async () => {
    const result = await tool.execute(toolCallId + '_b3', { command: 'ls' }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('hello.txt');
    expect(result.content).toContain('config.json');
  });

  it('錯誤的命令應該回傳非零 exit code', async () => {
    const result = await tool.execute(toolCallId + '_b4', { command: 'exit 42' }, testDir);
    expect(result.isError).toBe(true);
    expect(result.details?.exitCode).toBe(42);
  });

  it('不存在的命令應該回傳錯誤', async () => {
    const result = await tool.execute(toolCallId + '_b5', { command: 'nonexistent_command_xyz' }, testDir);
    expect(result.isError).toBe(true);
  });

  it('黑名單中的命令應該被拒絕', async () => {
    const result = await tool.execute(toolCallId + '_b6', { command: 'sudo rm -rf /' }, testDir);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('安全性拒絕');
  });

  it('缺少 command 參數應該回傳錯誤', async () => {
    const result = await tool.execute(toolCallId + '_b7', {}, testDir);
    expect(result.isError).toBe(true);
  });

  it('應該能執行 pipe 命令', async () => {
    const result = await tool.execute(toolCallId + '_b8', { command: 'echo "line1\nline2\nline3" | wc -l' }, testDir);
    expect(result.isError).toBe(false);
    expect(result.content.trim()).toBe('3');
  });
});

// ═══════════════════════════════════════════════════════════
// shell 路徑解析測試：確認 resolveShellPath 的行為
// ═══════════════════════════════════════════════════════════
describe('BashTool shell 路徑解析', () => {
  it('resolveShellPath() 應回傳現有的絕對路徑', () => {
    const resolved = BashTool.resolveShellPath();
    expect(resolved).toBeTruthy();
    // 應回傳絕對路徑（/bin/bash、/usr/bin/bash 或 /bin/sh）
    expect(resolved.startsWith('/')).toBe(true);
    // 確認路徑確實存在
    expect(existsSync(resolved)).toBe(true);
  });

  it('resolveShellPath() 不應回傳 "bash"（純 PATH 查找字串）', () => {
    // 在有 /bin/bash 的系統上，絕對不該退回 PATH 查找
    const resolved = BashTool.resolveShellPath();
    expect(resolved).not.toBe('bash');
    expect(resolved).not.toBe('sh');
  });

  it('使用絕對 shell 路徑 spawn 不應 ENOENT', async () => {
    const shellPath = BashTool.resolveShellPath();

    const result = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
      const child = spawn(shellPath, ['-c', 'echo SHELL_OK'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', (err: Error) => {
        resolve({ ok: false, err: err.message });
      });
      child.on('close', () => {
        resolve({ ok: out.includes('SHELL_OK') });
      });
    });

    expect(result.ok).toBe(true);
    if (result.err) {
      expect.fail(`spawn 失敗: ${result.err}`);
    }
  });

  it('即使 PATH 為空，spawn($shellPath, ...) 不應 ENOENT', async () => {
    const shellPath = BashTool.resolveShellPath();

    const result = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
      const child = spawn(shellPath, ['-c', 'echo OK'], {
        env: { PATH: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', (err: Error) => {
        resolve({ ok: false, err: err.message });
      });
      child.on('close', () => {
        resolve({ ok: out.includes('OK') });
      });
    });

    expect(result.ok).toBe(true);
    if (result.err) {
      expect.fail(`spawn (PATH='') 失敗: ${result.err}`);
    }
  });

  it('BashTool 在全空 PATH 環境中構造時不應拋出例外', () => {
    // 模擬 PATH 被清空的環境
    const origPath = process.env.PATH;
    try {
      delete process.env.PATH;
      const tool = new BashTool();
      expect(tool).toBeDefined();
    } finally {
      process.env.PATH = origPath;
    }
  });

});

// ═══════════════════════════════════════════════════════════
// 整合測試：多工具協作場景
// ═══════════════════════════════════════════════════════════
describe('Integration：多工具協作', () => {
  it('write → read → edit → bash 的連續操作應該正確', async () => {
    // 1. write: 建立一個 JS 檔案
    const writeTool = new WriteTool();
    const writeResult = await writeTool.execute('int_w1', {
      path: 'integration-test/app.js',
      content: 'const greeting = "Hello World";\nconsole.log(greeting);\nmodule.exports = { greeting };\n'
    }, testDir);
    expect(writeResult.isError).toBe(false);

    // 2. read: 確認檔案內容正確
    const readTool = new ReadTool();
    const readResult = await readTool.execute('int_r1', { path: 'integration-test/app.js' }, testDir);
    expect(readResult.isError).toBe(false);
    expect(readResult.content).toContain('"Hello World"');

    // 3. edit: 修改 greeting 內容
    const editTool = new EditTool();
    const editResult = await editTool.execute('int_e1', {
      path: 'integration-test/app.js',
      old_string: '"Hello World"',
      new_string: '"Hello Z-Agent"'
    }, testDir);
    expect(editResult.isError).toBe(false);

    // 4. bash: 執行 node 檢查語法
    const bashTool = new BashTool();
    const bashResult = await bashTool.execute('int_b1', { command: 'node -c integration-test/app.js' }, testDir);
    expect(bashResult.isError).toBe(false);
    // node -c 在語法正確時 exit code 0（無輸出內容也正常）
    expect(bashResult.details?.exitCode).toBe(0);
  });
});
