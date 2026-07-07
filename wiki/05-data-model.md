# 資料模型與儲存

## 1. 核心資料模型

### 1.1 Session（會話）

```typescript
interface Session {
  id: string;                    // UUID
  name: string;                  // 使用者可編輯的會話名稱
  createdAt: number;             // 建立時間戳
  updatedAt: number;             // 最後更新時間戳
  workingDirectory: string;      // 工作目錄路徑
  status: SessionStatus;         // 會話狀態
  settings: SessionSettings;     // 會話級設定
}

type SessionStatus = 
  | 'active'       // 使用中
  | 'completed'    // 已完成
  | 'archived';    // 已歸檔

interface SessionSettings {
  systemPromptTemplate: string;  // 系統提示詞模板名稱
  targetModel: string;           // 目標 LLM 模型
  enabledTools: string[];        // 啟用的工具列表
  maxOutputLines: number;        // 最大輸出行數
  bashTimeout: number;           // Bash 命令預設超時
}
```

### 1.2 Message（訊息）

```typescript
type Message = 
  | UserMessage
  | AssembledPromptMessage
  | LLMResponseMessage
  | ToolCallMessage
  | ToolResultMessage
  | SystemMessage;

interface BaseMessage {
  id: string;                    // 唯一識別碼
  sessionId: string;             // 所屬會話 ID
  timestamp: number;             // 時間戳
  parentId?: string;             // 父訊息 ID（用於分支）
}

// 使用者輸入的任務描述
interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

// 系統組裝的提示詞
interface AssembledPromptMessage extends BaseMessage {
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

// 使用者貼回的 LLM 回應
interface LLMResponseMessage extends BaseMessage {
  role: 'llm_response';
  rawContent: string;            // 原始貼上內容
  parsedContent: {
    textContent: string;         // 文字部分
    toolCalls: ToolCallData[];   // 解析出的工具呼叫
  };
  sourceModel?: string;          // 使用者標記的來源模型
}

// 工具呼叫
interface ToolCallMessage extends BaseMessage {
  role: 'tool_call';
  toolCallId: string;            // 工具呼叫 ID
  toolName: string;              // 工具名稱
  arguments: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  modifiedArguments?: Record<string, unknown>; // 修改後的參數
}

// 工具執行結果
interface ToolResultMessage extends BaseMessage {
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
  };
  executionTimeMs: number;       // 執行耗時
}

// 系統通知訊息
interface SystemMessage extends BaseMessage {
  role: 'system';
  content: string;
  level: 'info' | 'warning' | 'error';
}
```

### 1.3 ToolDefinition（工具定義）

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;        // JSON Schema 格式的參數定義
  executionMode: 'parallel' | 'sequential';
  promptSnippet: string;         // 一行簡短描述，用於系統提示詞
}

interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  toolCallId: string;
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
  executionTimeMs: number;
}
```

### 1.4 Configuration（全域設定）

```typescript
interface GlobalConfig {
  server: {
    port: number;                // 伺服器埠號
    host: string;                // 綁定位址
  };
  defaults: {
    workingDirectory: string;    // 預設工作目錄
    systemPromptTemplate: string;// 預設系統提示詞模板
    targetModel: string;         // 預設目標 LLM
    enabledTools: string[];      // 預設啟用工具
  };
  security: {
    allowedPaths: string[];      // 允許操作的路徑
    bashBlacklist: string[];     // 禁止的 bash 命令
    maxOutputSize: number;       // 最大輸出大小 (bytes)
  };
  promptTemplates: Record<string, string>; // 提示詞模板
}
```

## 2. 儲存方案

### 2.1 檔案系統結構

```
data/
├── config.json                  # 全域設定
├── sessions/
│   ├── index.json               # 會話索引（快速查詢用）
│   ├── {session-id}/
│   │   ├── session.json         # 會話元資料
│   │   └── messages.jsonl       # 訊息記錄（JSONL 格式）
│   └── ...
└── templates/
    ├── default.md               # 預設系統提示詞模板
    ├── coding-assistant.md      # 程式碼助理模板
    └── doc-writer.md            # 文件助理模板
```

### 2.2 JSONL 會話格式

參照 Pi 的 JSONL 會話格式，每行一個 JSON 物件：

```jsonl
{"id":"msg_001","role":"user","content":"建立 Express 伺服器","timestamp":1720000000000}
{"id":"msg_002","role":"assembled_prompt","fullText":"...","estimatedTokens":1200,"timestamp":1720000001000}
{"id":"msg_003","role":"llm_response","rawContent":"...","parsedContent":{...},"timestamp":1720000060000}
{"id":"msg_004","role":"tool_call","toolName":"write","arguments":{"path":"server.js","content":"..."},"status":"approved","timestamp":1720000061000}
{"id":"msg_005","role":"tool_result","toolCallId":"msg_004","isError":false,"content":"File written: server.js (245 bytes)","executionTimeMs":12,"timestamp":1720000062000}
```

### 2.3 會話索引

```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "name": "建立 Express 伺服器",
      "status": "active",
      "createdAt": 1720000000000,
      "updatedAt": 1720000062000,
      "messageCount": 5,
      "workingDirectory": "/home/user/projects/my-app"
    }
  ]
}
```

## 3. 分支支援

參照 Pi 的會話樹設計，支援從任意歷史點分支：

```typescript
// 每個訊息都有 parentId，形成樹狀結構
interface BranchableMessage extends BaseMessage {
  parentId?: string;    // 指向父訊息
  branchLabel?: string; // 分支標籤
}
```

分支使用場景：
1. LLM 給出不理想的回應 → 從上一步分支，嘗試不同的 LLM 或修改提示詞
2. 想同時嘗試兩種方案 → 從同一點分支出兩條路線
3. 回溯到更早的步驟 → 重新開始一段對話
