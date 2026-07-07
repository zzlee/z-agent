import { 
  Session, 
  Message, 
  ToolDefinition, 
  ToolCallData, 
  ToolCallMessage, 
  ToolResultMessage, 
  ToolResult, 
  ExecutionPlan, 
  ExecutionProgress, 
  LLMResponseMessage 
} from '../types.js';
import { AgentTool } from '../tools/base.js';
import { ReadTool } from '../tools/read.js';
import { WriteTool } from '../tools/write.js';
import { EditTool } from '../tools/edit.js';
import { BashTool } from '../tools/bash.js';
import { PromptAssembler, AssembledPrompt } from './prompt-assembler.js';
import { ResponseParser } from './response-parser.js';
import { DependencyPlanner } from './dependency-planner.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface AgentState {
  sessionId: string;
  messages: Message[];
  systemPromptTemplate: string;
  tools: ToolDefinition[];
  currentPhase: 'idle' | 'waiting_for_llm' | 'executing_tool' | 'completed';
  workingDirectory: string;
}

export class AgentEngine {
  state: AgentState;
  private toolsMap = new Map<string, AgentTool>();
  
  private assembler = new PromptAssembler();
  private parser = new ResponseParser();
  private planner = new DependencyPlanner();
  
  private promptTemplate = `You are a skilled coding assistant. You help the user with programming tasks by reading, writing, and editing files, and executing commands.

## Crucial Guidelines (Strict Compliance Required)
1. **Tool Call Formatting**: To use a tool, you MUST include a tool_call block in your response:
<tool_call name="TOOL_NAME">
{"param1": "value1", "param2": "value2"}
</tool_call>
2. **Strict Tool-Only Output constraint**: If you decide to call any tools, your output MUST contain ONLY the \`<tool_call>\` blocks. Do NOT write any thoughts, explanations, conversational filler, summaries, introductions, or comments outside the \`<tool_call>\` block. Any text outside \`<tool_call>\` blocks will break the executor.
3. **JSON Arguments**: The content inside the \`<tool_call>\` block MUST be a single, valid JSON object. Do not include markdown code fences (like \`\`\`json) inside the \`<tool_call>\` block.
4. **Final Unified Response**: If and only if you are completely finished with all tasks and do not need to call any more tools, you can reply with regular conversational text to summarize and present your final answer.
5. **Tool Execution Results**: After you submit a tool call, the executor will run it and feed the result back to you in the next turn in the following JSON-XML format:
<tool_result>
{
  "toolCallId": "...",
  "toolName": "TOOL_NAME",
  "status": "success" | "error",
  "content": "The actual text output of the tool execution"
}
</tool_result>

## Available Tools

{tool_descriptions}`;

  constructor(session: Session, initialMessages: Message[] = []) {
    this.state = {
      sessionId: session.id,
      messages: initialMessages,
      systemPromptTemplate: session.settings.systemPromptTemplate || 'coding-assistant',
      tools: [],
      currentPhase: 'idle',
      workingDirectory: session.workingDirectory
    };

    // 初始化預設工具
    this.registerTool(new ReadTool());
    this.registerTool(new WriteTool());
    this.registerTool(new EditTool());
    this.registerTool(new BashTool());

    // 篩選啟用的工具
    const enabledNames = new Set(session.settings.enabledTools || ['read', 'write', 'edit', 'bash']);
    this.state.tools = Array.from(this.toolsMap.values())
      .filter(t => enabledNames.has(t.definition.name))
      .map(t => t.definition);
  }

  private registerTool(tool: AgentTool) {
    this.toolsMap.set(tool.definition.name, tool);
  }

  setPromptTemplate(template: string) {
    this.promptTemplate = template;
  }

  /**
   * 產生要發送給 LLM 的提示詞
   */
  async assemblePrompt(): Promise<AssembledPrompt> {
    let agentsMdContent: string | undefined;

    // 嘗試讀取 agents.md 或 AGENTS.md
    const mdPaths = [
      join(this.state.workingDirectory, 'agents.md'),
      join(this.state.workingDirectory, 'AGENTS.md')
    ];

    for (const p of mdPaths) {
      try {
        agentsMdContent = await fs.readFile(p, 'utf8');
        break; // 讀取成功即跳出
      } catch {
        // 檔案不存在或讀取失敗則忽略，嘗試下一個
      }
    }

    const assembled = this.assembler.assemble(
      {
        id: this.state.sessionId,
        name: '',
        createdAt: 0,
        updatedAt: 0,
        workingDirectory: this.state.workingDirectory,
        status: 'active',
        settings: {
          systemPromptTemplate: this.state.systemPromptTemplate,
          targetModel: '',
          enabledTools: this.state.tools.map(t => t.name),
          maxOutputLines: 1000,
          bashTimeout: 30
        }
      },
      this.state.messages,
      this.state.tools,
      this.promptTemplate,
      agentsMdContent
    );

    this.state.currentPhase = 'waiting_for_llm';
    return assembled;
  }

  /**
   * 解析使用者貼回的 LLM 回應，將回應新增至對話歷史中。
   */
  parseResponse(rawResponse: string): { parsedTextContent: string; toolCalls: ToolCallData[]; parseErrors: string[] } {
    const parsed = this.parser.parse(rawResponse);
    
    const responseMessage: LLMResponseMessage = {
      id: `msg_${Date.now()}_resp`,
      sessionId: this.state.sessionId,
      timestamp: Date.now(),
      role: 'llm_response',
      rawContent: rawResponse,
      parsedContent: {
        textContent: parsed.textContent,
        toolCalls: parsed.toolCalls
      }
    };
    
    this.state.messages.push(responseMessage);
    return {
      parsedTextContent: parsed.textContent,
      toolCalls: parsed.toolCalls,
      parseErrors: parsed.parseErrors
    };
  }

  /**
   * 依據依賴關係分析工具呼叫，生成執行計畫
   */
  generateExecutionPlan(toolCalls: ToolCallData[]): ExecutionPlan {
    const messages = toolCalls.map((c, idx) => {
      const msg: ToolCallMessage = {
        id: c.id,
        sessionId: this.state.sessionId,
        timestamp: Date.now() + idx,
        role: 'tool_call',
        toolCallId: c.id,
        toolName: c.name,
        arguments: c.arguments,
        status: 'pending'
      };
      return msg;
    });

    return this.planner.generatePlan(messages, this.state.workingDirectory);
  }

  /**
   * 執行執行計畫中的批次工具呼叫（並行/依序混合）
   */
  async executeExecutionPlan(
    plan: ExecutionPlan, 
    onUpdate?: (progress: ExecutionProgress) => void
  ): Promise<ToolResult[]> {
    this.state.currentPhase = 'executing_tool';
    const allResults: ToolResult[] = [];
    const completedToolCallIds: string[] = [];

    // 將所有規劃執行的 tool call 訊息先加入歷史紀錄
    for (const stage of plan.stages) {
      for (const call of stage.toolCalls) {
        call.status = 'approved';
        this.state.messages.push(call);
      }
    }

    for (const stage of plan.stages) {
      const activeToolCallIds = stage.toolCalls.map(c => c.toolCallId);
      
      if (onUpdate) {
        onUpdate({
          currentStageIndex: stage.stageIndex,
          completedToolCallIds: [...completedToolCallIds],
          activeToolCallIds: [...activeToolCallIds]
        });
      }

      // 同一個 Stage 的工具呼叫，使用 Promise.all 並行執行
      const stagePromises = stage.toolCalls.map(async (call) => {
        const tool = this.toolsMap.get(call.toolName);
        if (!tool) {
          return {
            toolCallId: call.toolCallId,
            isError: true,
            content: `找不到此工具: "${call.toolName}"`,
            executionTimeMs: 0
          };
        }
        
        try {
          return await tool.execute(call.toolCallId, call.arguments, this.state.workingDirectory);
        } catch (err: any) {
          return {
            toolCallId: call.toolCallId,
            isError: true,
            content: err.message || '未知執行錯誤',
            executionTimeMs: 0
          };
        }
      });

      const stageResults = await Promise.all(stagePromises);
      allResults.push(...stageResults);

      for (const r of stageResults) {
        completedToolCallIds.push(r.toolCallId);
      }
    }

    this.state.currentPhase = 'idle';
    return allResults;
  }

  /**
   * 將批次工具結果加入對話歷史
   */
  appendToolResults(results: ToolResult[]): void {
    const resultsMap = new Map(this.state.messages
      .filter(m => m.role === 'tool_call')
      .map(m => [(m as ToolCallMessage).toolCallId, m as ToolCallMessage])
    );

    for (const res of results) {
      const toolCallMsg = resultsMap.get(res.toolCallId);
      const name = toolCallMsg ? toolCallMsg.toolName : 'unknown';

      const resultMsg: ToolResultMessage = {
        id: `msg_${Date.now()}_res_${res.toolCallId}`,
        sessionId: this.state.sessionId,
        timestamp: Date.now(),
        role: 'tool_result',
        toolCallId: res.toolCallId,
        toolName: name,
        isError: res.isError,
        content: res.content,
        details: res.details,
        executionTimeMs: res.executionTimeMs
      };

      this.state.messages.push(resultMsg);
    }
  }
}
