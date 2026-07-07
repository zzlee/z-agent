# Agent Loop 與人機協作流程

## 1. 核心理念

傳統 AI Agent 的 Agent Loop：
```
User Input → LLM → Tool Call → Tool Result → LLM → ... → Final Response
```

Z-Agent 的人機協作 Agent Loop：
```
User Input → [系統組裝提示詞] → [使用者複製到外部 LLM] → [使用者貼回 LLM 回應] → [系統解析回應] → Tool Call → Tool Result → [系統組裝新提示詞] → [使用者複製到外部 LLM] → ...
```

## 2. 完整流程

### 2.1 循環狀態機

```
                    ┌─────────────┐
                    │    IDLE     │
                    └──────┬──────┘
                           │ 使用者輸入任務
                           ▼
                    ┌─────────────┐
                    │  ASSEMBLING │ 系統組裝提示詞
                    └──────┬──────┘
                           │
                           ▼
                   ┌──────────────┐
                   │ WAITING_LLM  │ 等待使用者複製貼上
                   └──────┬───────┘
                          │ 使用者貼回回應
                          ▼
                   ┌──────────────┐
                   │   PARSING    │ 解析 LLM 回應
                   └──────┬───────┘
                          │
                ┌─────────┴──────────┐
                │                    │
        有工具呼叫              僅文字回應
                │                    │
                ▼                    ▼
        ┌──────────────┐     ┌────────────┐
        │  CONFIRMING  │     │ COMPLETED  │
        │  (確認執行)   │     └────────────┘
        └──────┬───────┘
               │ 使用者確認
               ▼
        ┌──────────────┐
        │  EXECUTING   │ 執行工具
        └──────┬───────┘
               │
               ▼
        ┌──────────────┐
        │  ASSEMBLING  │ 用工具結果組裝新提示詞
        └──────┬───────┘
               │
               ▼
        (回到 WAITING_LLM)
```

### 2.2 各階段詳細說明

#### IDLE 階段
- 系統等待使用者輸入任務描述
- 使用者可選擇建立新會話或恢復舊會話

#### ASSEMBLING 階段
系統自動組裝提示詞，包含：
1. **System Prompt**: Agent 角色設定 + 工具描述
2. **對話歷史**: 之前的交互記錄（若有）
3. **當前請求**: 使用者的任務描述或工具執行結果

#### WAITING_LLM 階段
- 系統顯示組裝好的提示詞
- 提供「一鍵複製」按鈕
- 使用者將提示詞貼到外部 LLM 服務
- 使用者將 LLM 回應貼回系統
- 提供「貼上 LLM 回應」輸入區域

#### PARSING 階段
系統解析 LLM 回應：
- 提取文字內容部分
- 辨識工具呼叫區塊（使用特定格式標記）
- 驗證工具呼叫參數
- 若解析失敗，提示使用者重試或手動修正

#### CONFIRMING 階段
- 顯示解析出的工具呼叫清單
- 使用者可以：
  - ✅ 確認全部執行
  - ✅ 選擇性執行
  - ✏️ 修改參數後執行
  - ❌ 跳過不執行

#### EXECUTING 階段
- **並行執行**：系統分析工具呼叫的依賴關係，無依賴的工具同時執行
- **依賴排序**：有順序依賴的工具依序執行（見下方「並行工具執行」章節）
- 即時顯示每個工具的執行進度和結果
- 記錄工具執行日誌

#### COMPLETED 階段
- 顯示最終結果
- 使用者可以：
  - 繼續追加指令（進入新循環）
  - 結束會話
  - 匯出會話記錄

## 3. 並行工具執行

### 3.1 設計原則

參照 Pi 的 `parallel` / `sequential` 執行模式設計，Z-Agent 支援在**不影響順序**的條件下**同時執行多個工具呼叫**。

核心規則：
- LLM 在一次回應中可提出多個工具呼叫
- 系統分析這些呼叫之間的**依賴關係**
- **無依賴的工具並行執行**，有依賴的工具按順序執行
- 所有結果收集完成後，統一組裝到下一輪提示詞中

### 3.2 依賴分析規則

| 情境 | 是否可並行 | 說明 |
|------|-----------|------|
| 多個 `read` | ✅ 可並行 | 唯讀操作互不影響 |
| 多個 `search` | ✅ 可並行 | 唯讀搜尋互不影響 |
| `read` + `search` | ✅ 可並行 | 都是唯讀操作 |
| `read` A → `edit` A | ❌ 依序 | edit 依賴 read 的結果（同檔案） |
| `write` A + `write` B | ✅ 可並行 | 不同檔案的寫入互不影響 |
| `write` A + `edit` A | ❌ 依序 | 同檔案的寫入必須依序 |
| `write` + `bash` | ❌ 依序 | bash 可能依賴寫入的檔案 |
| 多個獨立 `bash` | ⚠️ 可配置 | 預設依序，可手動標記為可並行 |

### 3.3 執行流程

```
LLM 回應包含 N 個工具呼叫
         │
         ▼
┌─────────────────────┐
│  依賴分析 (Dependency │
│  Analyzer)           │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  生成執行計畫         │
│  (Execution Plan)    │
│                     │
│  Stage 1: [T1, T2]  │  ← 並行執行
│  Stage 2: [T3]      │  ← 等 Stage 1 完成
│  Stage 3: [T4, T5]  │  ← 並行執行
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  使用者確認執行計畫    │
│  (顯示並行分組)       │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  按 Stage 依序執行    │
│  每個 Stage 內部並行  │
└────────┬────────────┘
         │
         ▼
   收集所有結果
   組裝下一輪提示詞
```

### 3.4 範例

LLM 回應中包含 4 個工具呼叫：

```
讓我先了解專案結構。

<tool_call name="read">
{"path": "package.json"}
</tool_call>

<tool_call name="read">
{"path": "src/index.ts"}
</tool_call>

<tool_call name="search">
{"pattern": "import express", "include": "*.ts"}
</tool_call>

<tool_call name="bash">
{"command": "ls -la src/"}
</tool_call>
```

系統分析後生成執行計畫：

```
執行計畫:
  Stage 1 (並行): read(package.json), read(src/index.ts), search(...), bash(ls)
  ↑ 四個呼叫都是唯讀操作，全部可並行
```

另一個有依賴的範例：

```
<tool_call name="read">
{"path": "config.json"}
</tool_call>

<tool_call name="write">
{"path": "config.json", "content": "..."}
</tool_call>

<tool_call name="bash">
{"command": "node validate.js"}
</tool_call>
```

執行計畫：

```
執行計畫:
  Stage 1: read(config.json)
  Stage 2: write(config.json)     ← 同檔案，需等 read 完成
  Stage 3: bash(node validate.js) ← 可能依賴 write 結果
```

### 3.5 結果排序

無論實際執行順序如何，工具結果在下一輪提示詞中**按 LLM 原始呼叫順序排列**。
這確保 LLM 看到的結果順序與它發出的呼叫順序一致，避免混淆。

## 4. 錯誤處理

### 4.1 LLM 回應解析失敗
- 顯示解析錯誤詳情
- 允許使用者手動編輯回應後重試
- 提供「跳過此步驟」選項

### 4.2 工具執行失敗
- 捕獲錯誤並格式化為工具結果
- 將錯誤資訊加入下一輪提示詞
- 讓 LLM 知道失敗原因並重試

### 4.3 上下文溢出
- 監控提示詞長度（估算 token 數）
- 當接近限制時提示使用者
- 提供「壓縮歷史」功能（參照 Pi 的 /compact 指令）

## 5. 會話持久化

每個步驟完成後自動儲存到 JSONL 檔案：

```jsonl
{"id":"msg_001","role":"user","content":"幫我建立一個 Express 伺服器","timestamp":1720000000000}
{"id":"msg_002","role":"assembled_prompt","content":"...","timestamp":1720000001000}
{"id":"msg_003","role":"llm_response","content":"...","source":"user_paste","timestamp":1720000060000}
{"id":"msg_004","role":"tool_call","name":"write","arguments":{"path":"server.js","content":"..."},"timestamp":1720000061000}
{"id":"msg_005","role":"tool_result","toolCallId":"msg_004","result":{"success":true},"timestamp":1720000062000}
```
