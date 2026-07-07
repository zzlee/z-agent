# Z-Agent：無 LLM 的人機協作 AI Agent

## 專案概述

Z-Agent 是一套**無內建 LLM** 的 AI Agent 系統。系統本身負責管理工作流程、工具執行、狀態追蹤，而所有需要語言模型推理的環節，都透過**使用者手動複製貼上**到外部 LLM 服務（如 ChatGPT、Claude、Gemini 等）來完成。

## 設計哲學

參照 [earendil-works/pi](https://github.com/earendil-works/pi) 的簡潔設計：

1. **極簡工具集**：仿照 Pi 僅提供 `read`、`write`、`edit`、`bash` 四個基礎工具的作法，Z-Agent 定義一組精簡但完備的工具集
2. **Agent Loop 由人驅動**：Pi 的 Agent Loop 是 `User → LLM → Tool → LLM → ...`，Z-Agent 將 LLM 環節替換為「使用者去外部 LLM 取得回應後貼回」
3. **結構化提示詞生成**：系統自動組裝上下文、工具描述、工作狀態成為可直接貼給 LLM 的提示詞
4. **Web 界面優先**：提供視覺化操作介面，降低複製貼上的操作摩擦

## 核心概念

```
┌────────────────────────────────────────────────────────┐
│                    Z-Agent Web UI                       │
│                                                        │
│  ┌──────────┐   ┌──────────┐   ┌────────────────────┐ │
│  │  任務管理  │   │ 工具面板  │   │   LLM 交互區域    │ │
│  │          │   │          │   │                    │ │
│  │ • 新增任務│   │ • read   │   │ ┌──────────────┐  │ │
│  │ • 任務歷史│   │ • write  │   │ │ 提示詞輸出    │  │ │
│  │ • 狀態追蹤│   │ • edit   │   │ │ (複製到 LLM) │  │ │
│  │          │   │ • bash   │   │ └──────────────┘  │ │
│  │          │   │ • search │   │ ┌──────────────┐  │ │
│  │          │   │          │   │ │ LLM回應輸入   │  │ │
│  │          │   │          │   │ │ (貼回系統)    │  │ │
│  └──────────┘   └──────────┘   │ └──────────────┘  │ │
│                                └────────────────────┘ │
└────────────────────────────────────────────────────────┘
         │                              ▲
         ▼                              │
┌─────────────────┐            ┌────────────────────┐
│   Agent Engine   │            │   外部 LLM 服務     │
│                 │            │  (ChatGPT/Claude/   │
│ • 工具執行器     │            │   Gemini/...)       │
│ • 狀態管理       │  使用者手動  │                    │
│ • 提示詞組裝器   │ ◄─────────►│                    │
│ • 會話記錄       │  複製貼上    │                    │
└─────────────────┘            └────────────────────┘
```

## 與 Pi 的設計對照

| 設計面向 | Pi (earendil-works/pi) | Z-Agent |
|---------|----------------------|---------|
| LLM 整合 | 內建多 Provider API | 無內建，使用者手動代理 |
| 工具集 | read, write, edit, bash | read, write, edit, bash, search |
| Agent Loop | 自動化循環 | 人工驅動循環 |
| 介面 | TUI (終端) | Web UI |
| 提示詞 | 自動發送給 LLM | 組裝後顯示，使用者複製 |
| 工具呼叫解析 | LLM 回應自動解析 | 使用者貼回後系統解析 |
| 狀態管理 | AgentState | 相同概念，Web 持久化 |
| 會話記錄 | JSONL | JSON 儲存 |
| 工具執行模式 | 支援並行 (parallel) 與依序 (sequential) | 支援依賴分析並行執行 (不影響順序下同時執行) |

## 文件索引

| 文件 | 說明 |
|-----|------|
| [01-architecture.md](01-architecture.md) | 系統架構設計 |
| [02-agent-loop.md](02-agent-loop.md) | Agent Loop 與人機協作流程 |
| [03-tools.md](03-tools.md) | 工具定義與提示詞設計 |
| [04-web-ui.md](04-web-ui.md) | Web 界面設計 |
| [05-data-model.md](05-data-model.md) | 資料模型與儲存 |
| [06-prompt-assembly.md](06-prompt-assembly.md) | 提示詞組裝機制 |
| [07-implementation-plan.md](07-implementation-plan.md) | 分階段實施計畫 |
