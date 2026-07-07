# Relay Loop：轉發循環與 DAG 執行

## 1. 循環本質

Z-Agent 的「Agent Loop」本質上是**轉發循環（Relay Loop）**，與傳統 AI Agent 的推理循環有根本不同：

**傳統 Agent Loop：**
```
User Input → LLM 推理 → Tool Call → Tool Result → LLM 推理 → ...
```

**Z-Agent Relay Loop：**
```
User Input → [系統組裝提示詞] → [使用者複製給外部 LLM]
  → [使用者貼回 LLM 回應] → [系統解析 + 執行工具]
  → [系統格式化結果] → [使用者複製結果回 LLM]
  → (下一輪循環)
```

Z-Agent 自身不推理，它只是**提示詞 → 回應 → 工具執行 → 結果**的轉發管道。

## 2. 狀態機

```
IDLE ──[使用者輸入指令]──> ASSEMBLING ──> WAITING_LLM
                                           │
                              [使用者貼回回應]
                                           │
                                           ▼
                                      PARSING
                                     /       \
                             有工具呼叫     僅文字
                                  │           │
                                  ▼           ▼
                              CONFIRMING    COMPLETED
                                  │
                            [使用者確認]
                                  │
                                  ▼
                              EXECUTING
                                  │
                                  ▼
                              (回到 ASSEMBLING，附上結果)
```

每個階段的轉換都由使用者手動觸發（複製或貼上），系統不自動推進。

## 3. 多工具依賴執行

這是 Z-Agent 唯一「聰明」的地方：當 LLM 一次發出多個工具呼叫時，系統會分析它們之間的依賴關係。

### 3.1 依賴規則

| 情境 | 可否並行 | 原因 |
|------|---------|------|
| 多個 read | ✅ 可並行 | 唯讀操作互不影響 |
| read → edit 同檔案 | ❌ 需依序 | edit 可能依賴 read 結果 |
| write A + write B | ✅ 可並行 | 不同檔案互不影響 |
| write + bash | ❌ 需依序 | bash 可能依賴寫入的檔案 |
| bash + 任何工具 | ❌ 需依序 | bash 是黑盒子屏障 |

### 3.2 分 Stage 執行

```
LLM 回應包含 N 個工具呼叫
         │
         ▼
 依賴分析 (Dependency Analyzer)
         │
         ▼
 執行計畫 (Execution Plan):
   Stage 1: [read(a), read(b)]      ← 並行執行
   Stage 2: [edit(a)]               ← 等待 Stage 1
   Stage 3: [write(c), bash(d)]     ← 等待 Stage 2
         │
         ▼
 逐 Stage 執行，同 Stage 內並行
```

### 3.3 結果排序

無論執行順序如何，最終工具結果會按 LLM 原始呼叫順序排列，確保 LLM 看到的結果與它的呼叫順序一致。

## 4. 錯誤處理

- **解析失敗**：LLM 回應中的 tool_call 格式錯誤時，顯示錯誤位置，允許使用者手動修正後重試
- **執行錯誤**：工具執行失敗（如檔案不存在、命令逾時）時，將錯誤資訊格式化為 tool_result，由 LLM 自行決定如何處理
- **安全攔截**：路徑穿越、黑名單命令等安全性問題在執行前阻斷
