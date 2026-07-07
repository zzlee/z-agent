export type SessionStatus = 'active' | 'completed' | 'archived';

export interface SessionSettings {
  systemPromptTemplate: string;  // 系統提示詞模板名稱
  targetModel: string;           // 目標 LLM 模型
  enabledTools: string[];        // 啟用的工具列表
  maxOutputLines: number;        // 最大輸出行數
  bashTimeout: number;           // Bash 命令預設超時 (秒)
}

export interface Session {
  id: string;                    // UUID
  name: string;                  // 使用者可編輯的會話名稱
  createdAt: number;             // 建立時間戳
  updatedAt: number;             // 最後更新時間戳
  workingDirectory: string;      // 工作目錄路徑
  status: SessionStatus;         // 會話狀態
  settings: SessionSettings;     // 會話級設定
}

export interface BaseMessage {
  id: string;                    // 唯一識別碼
  sessionId: string;             // 所屬會話 ID
  timestamp: number;             // 時間戳
  parentId?: string;             // 父訊息 ID（用於分支）
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

export interface AssembledPromptMessage extends BaseMessage {
  role: 'assembled_prompt';
  fullText: string;              // 完整提示詞
  sections: {
    systemPrompt: string;
    toolDescriptions: string;
    conversationHistory: string;
    currentRequest: string;
  };
  estimatedTokens: number;
}

export interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMResponseMessage extends BaseMessage {
  role: 'llm_response';
  rawContent: string;            // 原始貼上內容
  parsedContent: {
    textContent: string;         // 文字部分
    toolCalls: ToolCallData[];   // 解析出的工具呼叫
  };
  sourceModel?: string;          // 使用者標記的來源模型
}

export interface ToolCallMessage extends BaseMessage {
  role: 'tool_call';
  toolCallId: string;            // 工具呼叫 ID (由 LLM 產生或系統指派)
  toolName: string;              // 工具名稱
  arguments: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  modifiedArguments?: Record<string, any>; // 修改後的參數
}

export interface ToolResultMessage extends BaseMessage {
  role: 'tool_result';
  toolCallId: string;            // 對應的工具呼叫 ID
  toolName: string;
  isError: boolean;
  content: string;               // 結果文字
  details?: {
    exitCode?: number;           // bash 的 exit code
    bytesWritten?: number;       // write 的寫入位元組
    linesRead?: number;          // read 的讀取行數
    matchCount?: number;         // search 的匹配數
    truncated?: boolean;         // 是否被截斷
    [key: string]: any;
  };
  executionTimeMs: number;       // 執行耗時
}

export interface SystemMessage extends BaseMessage {
  role: 'system';
  content: string;
  level: 'info' | 'warning' | 'error';
}

export type Message =
  | UserMessage
  | AssembledPromptMessage
  | LLMResponseMessage
  | ToolCallMessage
  | ToolResultMessage
  | SystemMessage;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  executionMode: 'parallel' | 'sequential';
  promptSnippet: string;         // 一行簡短描述，用於系統提示詞
}

export interface ToolResult {
  toolCallId: string;
  isError: boolean;
  content: string;
  details?: Record<string, any>;
  executionTimeMs: number;
}

export interface ExecutionPlan {
  stages: {
    stageIndex: number;
    toolCalls: ToolCallMessage[]; // 同一個 Stage 內的工具呼叫可並行執行
  }[];
}

export interface ExecutionProgress {
  currentStageIndex: number;
  completedToolCallIds: string[];
  activeToolCallIds: string[];
}

export interface GlobalConfig {
  server: {
    port: number;
    host: string;
  };
  defaults: {
    workingDirectory: string;
    systemPromptTemplate: string;
    targetModel: string;
    enabledTools: string[];
  };
  security: {
    allowedPaths: string[];
    bashBlacklist: string[];
    maxOutputSize: number;       // bytes
  };
  promptTemplates: Record<string, string>;
}
