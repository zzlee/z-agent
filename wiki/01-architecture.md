# Z-Agent 轉發閘道系統架構

## 1. 整體架構

Z-Agent 作為 LLM Tool-Use 轉發閘道，採用極簡前後端分離架構：

### 技術選型
- **後端**: Node.js + Express
- **前端**: 單頁應用 SPA (Vanilla JS + CSS)
- **儲存**: 檔案系統 (JSON/JSONL，輕量會話記錄)
- **通訊**: REST API + WebSocket（執行進度推送）

### 架構圖

```
┌──────────────────────────────────────────────────────────┐
│                     Web Browser                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                Z-Agent Relay UI                    │  │
│  │                                                    │  │
│  │  ┌──────────────┐  ┌────────────┐  ┌────────────┐ │  │
│  │  │ Prompt Display│  │   Response │  │   Tool     │ │  │
│  │  │ (複製給 LLM)  │  │   Input    │  │   Plan &   │ │  │
│  │  │              │  │ (貼回回應) │  │   Execute  │ │  │
│  │  └──────────────┘  └────────────┘  └────────────┘ │  │
│  └────────────────────────────────────────────────────┘  │
│                        │ REST / WebSocket                │
└────────────────────────┼─────────────────────────────────┘
                         │
┌────────────────────────┼─────────────────────────────────┐
│                    Z-Agent Server (Relay Engine)           │
│                                                           │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │  Session      │  │  Agent Engine   │  │  Tool        │  │
│  │  Manager      │  │                 │  │  Executor    │  │
│  │  (輕量會話)   │  │ • PromptAssem   │  │              │  │
│  │               │  │   -bler        │  │ • ReadTool   │  │
│  │               │  │ • ResponsePars  │  │ • WriteTool  │  │
│  │               │  │   -er          │  │ • EditTool   │  │
│  │               │  │ • Dependency   │  │ • BashTool   │  │
│  │               │  │   -Planner     │  │              │  │
│  │               │  │                │  │              │  │
│  └───────────────┘  └────────────────┘  └──────────────┘  │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                  Storage Layer                        │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │ │
│  │  │ sessions/│  │   config/    │  │  workspace/    │  │ │
│  │  │ (JSONL)  │  │ (settings)   │  │ (工作檔案目錄)│  │ │
│  │  └──────────┘  └──────────────┘  └────────────────┘  │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

## 2. 模組設計

### 2.1 Agent Engine（轉發引擎）

核心引擎只做三件事：
1. **組裝提示詞**：將系統提示詞、工具描述、對話歷史合併成一份文字
2. **解析回應**：從使用者貼回的 LLM 回應中提取 `<tool_call>` 標記
3. **依賴分析與執行**：對多個工具呼叫做 DAG 依賴分析後分 Stage 執行

```typescript
interface AgentEngine {
  assemblePrompt(): AssembledPrompt;
  parseResponse(rawResponse: string): ParsedResponse;
  generateExecutionPlan(toolCalls: ToolCall[]): ExecutionPlan;
  executeExecutionPlan(plan: ExecutionPlan, onUpdate): Promise<ToolResult[]>;
  appendToolResults(results: ToolResult[]): void;
}
```

### 2.2 Tool Executor（工具執行器）

與常規 coding agent 相同的五個核心工具，每個有精確的 JSON Schema：

| 工具 | 功能 | 安全限制 |
|------|------|---------|
| read | 讀取檔案（支援 offset/limit） | 限定工作目錄內 |
| write | 寫入/覆蓋檔案，自動建立目錄 | 限定工作目錄內 |
| edit | 精確文字替換（old_string → new_string） | 限定工作目錄內 |
| bash | 執行 shell 命令（可逾時） | 白名單/黑名單配置 |
| — | 搜尋功能由 LLM 透過 bash 呼叫 rg/grep/find 自行實現 | — |

### 2.3 Session Manager（輕量會話管理）

僅提供基本的會話建立、儲存、讀取，不包含分支、壓縮等複雜功能。

### 2.4 API Gateway

轉發閘道只需要極少端點：

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/sessions` | GET/POST | 列出/建立會話 |
| `/api/sessions/:id` | GET/DELETE | 取得/刪除會話 |
| `/api/sessions/:id/prompt` | GET | 取得當前組裝的提示詞 |
| `/api/sessions/:id/message` | POST | 提交使用者指令 |
| `/api/sessions/:id/response` | POST | 提交 LLM 回應，回傳解析結果與執行計畫 |
| `/api/sessions/:id/execute` | POST | 執行確認的計畫 |
| `ws://` | WebSocket | 即時執行進度推送 |

## 3. 目錄結構

```
z-agent/
├── wiki/                    # 設計文件
├── server/                  # 後端服務 (Relay Engine)
│   ├── src/
│   │   ├── engine/          # 核心轉發引擎
│   │   ├── tools/           # 工具實作
│   │   ├── session/         # 會話管理
│   │   ├── api/             # API 路由
│   │   └── main.ts          # 啟動入口
├── web/                     # 前端 (Relay UI)
│   ├── index.html
│   ├── css/
│   └── js/
├── data/                    # 資料儲存
│   ├── sessions/
│   └── config/
└── package.json
```
