import { describe, it, expect } from 'vitest';
import { ResponseParser } from '../engine/response-parser.js';
import { DependencyPlanner } from '../engine/dependency-planner.js';
import { PromptAssembler } from '../engine/prompt-assembler.js';
import { ToolCallMessage, Session } from '../types.js';

describe('ResponseParser', () => {
  it('應該能正確解析單個或多個工具呼叫', () => {
    const parser = new ResponseParser();
    const raw = `這個是說明的開頭。
<tool_call name="read">
{"path": "package.json"}
</tool_call>
中間的一些說明文字。
<tool_call name="write">
{"path": "src/index.ts", "content": "console.log('hi');"}
</tool_call>
結尾說明。`;

    const result = parser.parse(raw);
    expect(result.textContent).toContain('這個是說明的開頭。');
    expect(result.textContent).toContain('中間的一些說明文字。');
    expect(result.textContent).toContain('結尾說明。');
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe('read');
    expect(result.toolCalls[0].arguments).toEqual({ path: 'package.json' });
    expect(result.toolCalls[1].name).toBe('write');
    expect(result.toolCalls[1].arguments).toEqual({ path: 'src/index.ts', content: "console.log('hi');" });
    expect(result.parseErrors).toHaveLength(0);
  });

  it('如果 JSON 格式錯誤應該捕獲解析錯誤', () => {
    const parser = new ResponseParser();
    const raw = `<tool_call name="read">
{"path": "package.json", 
</tool_call>`;
    const result = parser.parse(raw);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0]).toContain('解析工具 "read" 的參數失敗');
  });
});

describe('DependencyPlanner', () => {
  const planner = new DependencyPlanner();
  const mockCwd = '/home/user/project';

  const makeCall = (id: string, name: string, path?: string): ToolCallMessage => ({
    id,
    sessionId: 'session_1',
    timestamp: Date.now(),
    role: 'tool_call',
    toolCallId: id,
    toolName: name,
    arguments: path ? { path } : {},
    status: 'pending'
  });

  it('如果是多個獨立的讀取/搜尋工具，應該歸類在同一個並行 Stage', () => {
    const calls = [
      makeCall('c1', 'read', 'a.ts'),
      makeCall('c2', 'read', 'b.ts'),
      makeCall('c3', 'search', 'c.ts')
    ];

    const plan = planner.generatePlan(calls, mockCwd);
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0].stageIndex).toBe(1);
    expect(plan.stages[0].toolCalls).toHaveLength(3);
  });

  it('如果同一個檔案先讀取後寫入/修改，寫入/修改應該依賴於讀取，排在下一個 Stage', () => {
    const calls = [
      makeCall('c1', 'read', 'a.ts'),
      makeCall('c2', 'edit', 'a.ts'), // 對相同檔案編輯
      makeCall('c3', 'read', 'b.ts')  // 獨立讀取
    ];

    const plan = planner.generatePlan(calls, mockCwd);
    // c1 (read a.ts) 與 c3 (read b.ts) 在 Stage 1
    // c2 (edit a.ts) 在 Stage 2 (因為依賴於 c1)
    expect(plan.stages).toHaveLength(2);
    expect(plan.stages[0].toolCalls.map(c => c.toolCallId)).toEqual(['c1', 'c3']);
    expect(plan.stages[1].toolCalls.map(c => c.toolCallId)).toEqual(['c2']);
  });

  it('如果遇到 bash 工具，應該作為順序障礙物，之後的工具需等待其完成', () => {
    const calls = [
      makeCall('c1', 'read', 'a.ts'),
      makeCall('c2', 'bash'),
      makeCall('c3', 'read', 'b.ts')
    ];

    const plan = planner.generatePlan(calls, mockCwd);
    expect(plan.stages).toHaveLength(3);
    expect(plan.stages[0].toolCalls.map(c => c.toolCallId)).toEqual(['c1']);
    expect(plan.stages[1].toolCalls.map(c => c.toolCallId)).toEqual(['c2']);
    expect(plan.stages[2].toolCalls.map(c => c.toolCallId)).toEqual(['c3']);
  });
});

describe('PromptAssembler', () => {
  const assembler = new PromptAssembler();
  const mockSession: Session = {
    id: 's_1',
    name: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workingDirectory: '/test/dir',
    status: 'active',
    settings: {
      systemPromptTemplate: 'coding-assistant',
      targetModel: 'claude-3-5-sonnet',
      enabledTools: ['read'],
      maxOutputLines: 100,
      bashTimeout: 30
    }
  };

  it('應該正確估算中英文 Token 數量', () => {
    expect(assembler.estimateTokens('Hello World')).toBe(4); // 11 chars * 0.3 = 3.3 -> 4
    expect(assembler.estimateTokens('你好')).toBe(2); // 2 chars * 0.67 = 1.34 -> 2
  });

  it('應該組裝提示詞並替換範本變數', () => {
    const template = 'CWD={cwd}, DATE={date}, TOOLS:\n{tool_descriptions}';
    const tools = [{
      name: 'read',
      description: 'read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'the path' } },
        required: ['path']
      },
      executionMode: 'parallel' as const,
      promptSnippet: 'read a file'
    }];

    const result = assembler.assemble(mockSession, [], tools, template);
    expect(result.fullText).toContain('CWD=/test/dir');
    expect(result.fullText).toContain('read a file');
    expect(result.fullText).toContain('**path** (string, required): the path');
  });
});
