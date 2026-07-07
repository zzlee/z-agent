# 系統架構設計

## 1. 整體架構

Z-Agent 採用前後端分離架構：

### 技術選型
- **後端**: Node.js + Express (或 Fastify)
- **前端**: 單頁應用 (Vanilla JS + CSS，或 Vue.js/React)
- **儲存**: 檔案系統 (JSON/JSONL) — 簡單易部署
- **通訊**: REST API + WebSocket (即時狀態更新)

### 架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                        Web Browser                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   Z-Agent Web UI                      │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────────────┐ │  │
│  │  │ TaskView │ │ ToolPanel│ │   LLM Clipboard Zone   │ │  │
│  │  └─────────┘ └──────────┘ └────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │ REST / WebSocket                 │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                    Z-Agent Server                            │
│  ┌───────────────────────┼───────────────────────────────┐  │
│  │              API Gateway (Express/Fastify)             │  │
│  └───────────────────────┼───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────┐  ┌────────┴────────┐  ┌─────────────────┐   │
│  │ Session   │  │  Agent Engine    │  │  Tool Executor  │   │
│  │ Manager   │  │                  │  │                 │   │
│  │           │  │ • PromptAssembler│  │ • ReadTool      │   │
│  │ • 建立    │  │ • StateManager   │  │ • WriteTool     │   │
│  │ • 恢復    │  │ • ResponseParser │  │ • EditTool      │   │
│  │ • 分支    │  │ • LoopController │  │ • BashTool      │   │
│  │ • 匯出    │  │                  │  │ • SearchTool    │   │
│  └───────────┘  └─────────────────┘  └─────────────────┘   │
│                          │                                  │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │                  Storage Layer                         │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐ │  │
│  │  │ sessions/│  │   projects/   │  │    workspace/    │ │  │
│  │  │  (JSONL) │  │  (settings)   │  │ (工作檔案目錄)   │ │  │
│  │  └──────────┘  └──────────────┘  └──────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 2. 模組設計

### 2.1 Agent Engine（核心引擎）

核心引擎負責管理 Agent 的生命週期，但**不直接呼叫 LLM**。

```typescript
interface AgentEngine {
  // 狀態管理
  state: AgentState;
  
  // 產生要發送給 LLM 的提示詞
  assemblePrompt(): AssembledPrompt;
  
  // 解析使用者貼回的 LLM 回應
  parseResponse(rawResponse: string): ParsedResponse;
  
  // 依據依賴關係分析工具呼叫，生成執行計畫
  generateExecutionPlan(toolCalls: ToolCall[]): ExecutionPlan;
  
  // 執行執行計畫中的批次工具呼叫（並行/依序混合）
  executeExecutionPlan(plan: ExecutionPlan, onUpdate?: (progress: ExecutionProgress) => void): Promise<ToolResult[]>;
  
  // 將工具結果加入上下文，準備下一輪
  appendToolResults(results: ToolResult[]): void;
}

interface ExecutionPlan {
  stages: {
    stageIndex: number;
    toolCalls: ToolCall[]; // 同一個 Stage 內的工具呼叫可並行執行
  }[];
}

interface ExecutionProgress {
  currentStageIndex: number;
  completedToolCallIds: string[];
  activeToolCallIds: string[];
}

interface AgentState {
  sessionId: string;
  messages: Message[];      // 完整對話記錄
  systemPrompt: string;     // 系統提示詞
  tools: ToolDefinition[];  // 可用工具列表
  currentPhase: 'idle' | 'waiting_for_llm' | 'executing_tool' | 'completed';
  workingDirectory: string;
}
```

### 2.2 Prompt Assembler（提示詞組裝器）

負責將系統提示詞、工具描述、對話歷史、工具執行結果組裝成一段完整的提示詞，供使用者複製到外部 LLM。

```typescript
interface AssembledPrompt {
  fullText: string;        // 完整提示詞文字
  sections: {
    systemPrompt: string;  // 系統角色設定
    toolDescriptions: string; // 工具描述區塊
    conversationHistory: string; // 歷史對話
    currentRequest: string;    // 當前請求/工具結果
  };
  metadata: {
    estimatedTokens: number;
    timestamp: number;
  };
}
```

### 2.3 Response Parser（回應解析器）

解析使用者貼回的 LLM 回應，提取文字訊息和工具呼叫指令。

```typescript
interface ParsedResponse {
  textContent: string;           // LLM 的文字回應
  toolCalls: ToolCall[];         // 提取出的工具呼叫
  parseErrors: string[];         // 解析錯誤
  raw: string;                   // 原始回應文字
}

interface ToolCall {
  id: string;
  name: string;       // 'read' | 'write' | 'edit' | 'bash' | 'search'
  arguments: Record<string, unknown>;
}
```

### 2.4 Tool Executor（工具執行器）

參照 Pi 的設計，提供精簡的工具集。每個工具有明確的 schema 和執行邏輯。

### 2.5 Session Manager（會話管理器）

管理會話的建立、恢復、分支。參照 Pi 使用 JSONL 格式儲存會話歷史。

### 2.6 API Gateway

提供 RESTful API 和 WebSocket 端點：

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/sessions` | GET | 列出所有會話 |
| `/api/sessions` | POST | 建立新會話 |
| `/api/sessions/:id` | GET | 取得會話詳情 |
| `/api/sessions/:id/prompt` | GET | 取得當前需發送的提示詞 |
| `/api/sessions/:id/response` | POST | 提交 LLM 回應 |
| `/api/sessions/:id/tool-results` | GET | 取得工具執行結果 |
| `/api/sessions/:id/execute` | POST | 確認執行工具呼叫 |
| `/api/tools/:name/execute` | POST | 直接執行工具（測試用） |
| `ws://` | WebSocket | 即時狀態更新推送 |

## 3. 安全考量

- **Bash 工具白名單/黑名單**：可配置允許/禁止的命令
- **檔案操作範圍限制**：限制 read/write/edit 在指定工作目錄下
- **輸出截斷**：大檔案和長輸出自動截斷（參照 Pi 的 truncate 機制）
- **會話隔離**：每個會話有獨立的工作目錄上下文

## 4. 目錄結構

```
z-agent/
├── wiki/                    # 設計文件
├── server/                  # 後端服務
│   ├── src/
│   │   ├── engine/          # Agent 核心引擎
│   │   │   ├── agent.ts
│   │   │   ├── prompt-assembler.ts
│   │   │   ├── response-parser.ts
│   │   │   └── state.ts
│   │   ├── tools/           # 工具實作
│   │   │   ├── index.ts
│   │   │   ├── read.ts
│   │   │   ├── write.ts
│   │   │   ├── edit.ts
│   │   │   ├── bash.ts
│   │   │   └── search.ts
│   │   ├── session/         # 會話管理
│   │   │   ├── session-manager.ts
│   │   │   └── session-store.ts
│   │   ├── api/             # API 路由
│   │   │   ├── routes.ts
│   │   │   └── websocket.ts
│   │   └── main.ts
│   ├── package.json
│   └── tsconfig.json
├── web/                     # 前端
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── assets/
├── data/                    # 資料儲存
│   ├── sessions/
│   └── config/
└── package.json
```
