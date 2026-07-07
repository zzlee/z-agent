# 資料模型與儲存

## 1. 核心資料模型

### 1.1 Session（會話）

僅保留必要的會話元資料：

```typescript
interface Session {
  id: string;                    // UUID
  name: string;                  // 會話名稱
  createdAt: number;             // 建立時間
  updatedAt: number;             // 最後更新時間
  workingDirectory: string;      // 工作目錄
  status: 'active' | 'completed' | 'archived';
}
```

### 1.2 Message（訊息）

每種角色對應一種訊息型別：

```typescript
type Message = 
  | UserMessage           // 使用者指令
  | AssembledPromptMessage // 系統組裝的提示詞（不顯示於歷史）
  | LLMResponseMessage    // LLM 回應（含解析出的 tool_calls）
  | ToolCallMessage       // 工具呼叫記錄
  | ToolResultMessage     // 工具執行結果
  | SystemMessage;        // 系統通知
```

訊息以 JSONL 格式儲存：

```jsonl
{"id":"msg_001","role":"user","content":"幫我建立 Express 伺服器","timestamp":1720000000000}
{"id":"msg_002","role":"llm_response","rawContent":"...","parsedContent":{"textContent":"...","toolCalls":[...]},"timestamp":1720000060000}
{"id":"msg_003","role":"tool_call","toolName":"write","arguments":{"path":"server.js","content":"..."},"status":"approved","timestamp":1720000061000}
{"id":"msg_004","role":"tool_result","toolCallId":"msg_003","isError":false,"content":"File written: server.js (245 bytes)","executionTimeMs":12,"timestamp":1720000062000}
```

## 2. 儲存結構

```
data/
├── config.json                  # 全域設定
├── sessions/
│   ├── index.json               # 會話索引
│   └── {session-id}/
│       ├── session.json         # 會話元資料
│       └── messages.jsonl       # 訊息記錄
└── templates/
    └── coding-assistant.md      # 預設提示詞模板
```

## 3. 設計原則

- **無資料庫依賴**：全部使用 JSON/JSONL 檔案儲存，部署簡單
- **無分支功能**：不需要樹狀歷史結構，線性歷史即可滿足轉發需求
- **無壓縮功能**：不提供歷史壓縮，需要時使用者可手動建立新會話
- **輕量索引**：會話索引僅用於快速列出會話，不做複雜查詢
