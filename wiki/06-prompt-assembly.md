# 提示詞組裝機制

## 1. 組裝原理

提示詞組裝器的目標是將所有必要的上下文打包成一段完整的文字，讓使用者可以直接貼到外部 LLM 使用。

參照 Pi 的 `buildSystemPrompt()` 設計，組裝結果包含四個區塊：

1. **System Prompt** — 角色設定 + 行為規範 + 工作目錄資訊
2. **Tool Descriptions** — 可用工具列表 + schema + 呼叫格式
3. **Conversation History** — 之前的 user/assistant 交互 + 工具結果
4. **Current Request** — 使用者最新指令或最新工具執行結果

## 2. 系統提示詞模板

### 2.1 預設模板（Coding Assistant）

模板以 Markdown 格式撰寫，關鍵結構如下：

- 角色宣告：`You are a skilled coding assistant...`
- 環境區塊：包含 `{cwd}`（工作目錄）、`{date}`（日期）、`{os}`（作業系統）
- 行為準則（Guidelines）：讀取前先確認、小修改用 edit、大修改用 write 等
- 工具描述：由 `{tool_descriptions}` 變數自動展開
- 工具呼叫格式說明：告知 LLM 使用 XML 標記格式

### 2.2 模板變數

| 變數 | 說明 | 範例值 |
|------|------|--------|
| `{cwd}` | 當前工作目錄 | `/home/user/project` |
| `{date}` | 當前日期 | `2026-07-07` |
| `{os}` | 作業系統 | `linux` |
| `{tool_descriptions}` | 工具描述區塊 | （自動生成） |

### 2.3 自訂模板支援

使用者可在 `data/templates/` 下建立自訂模板：

```
data/templates/
  default.md               # 預設通用模板
  coding-assistant.md      # 程式碼助理（預設）
  doc-writer.md            # 文件撰寫助理
  custom-*.md              # 使用者自訂模板
```

## 3. 工具描述生成

參照 Pi 的設計，每個工具的描述由兩部分構成：

### 3.1 精簡描述（system prompt 頂部摘要）

```
Tools: read (read files), write (create/overwrite files),
       edit (precise text replacement), bash (execute commands),
       search (grep files)
```

### 3.2 詳細描述

每個工具會生成包含以下資訊的描述區塊：
- 工具名稱和一句話說明
- 參數列表（名稱、型別、是否必填、說明）
- 使用範例

### 3.3 工具呼叫 XML 格式

提示詞中告知 LLM 使用以下 XML 格式呼叫工具：

```
[tool_call name="工具名稱"]
{"參數名": "參數值"}
[/tool_call]
```

> 注意：實際使用角括號 `<>` 而非方括號 `[]`，此處為避免 Markdown 渲染問題。

多個工具可以在同一個回應中呼叫。

## 4. 對話歷史格式化

### 4.1 標準格式

對話歷史會被格式化為清晰的區塊，包含以下角色標記：

- `User:` — 使用者輸入
- `Assistant:` — LLM 的文字回應
- `Tool Call:` — LLM 發起的工具呼叫（含工具名和參數）
- `Tool Result:` — 工具執行結果（成功/失敗）

### 4.2 工具結果格式

工具結果使用 `tool_result` XML 標記包裹，包含：
- `name` 屬性：工具名稱
- `status` 屬性：`success` 或 `error`
- 結果內容文字

### 4.3 歷史壓縮

當對話歷史過長時，可進行壓縮（參照 Pi 的 `/compact` 機制）：

1. **保留策略**：保留最近 N 輪對話完整內容
2. **摘要策略**：較早的對話壓縮為摘要
3. **工具結果精簡**：僅保留成功/失敗狀態和關鍵資訊

## 5. Token 估算

### 5.1 估算規則

| 語言 | 估算比例 |
|------|----------|
| 英文 | 約 1 token / 4 字元 |
| 中文 | 約 1 token / 1.5 字元 |
| 程式碼 | 約 1 token / 3.5 字元 |

### 5.2 顯示方式

Web UI 底部狀態列顯示：
- 當前提示詞估算 token 數
- 各區塊佔比（系統提示詞 / 歷史 / 當前請求）
- 接近目標模型上限時以警告色標示

## 6. 組裝流程（Pseudocode）

```typescript
function assemblePrompt(session: Session): AssembledPrompt {
  const template = loadTemplate(session.settings.systemPromptTemplate);
  
  // 1. 填充系統提示詞模板
  const systemPrompt = template
    .replace('{cwd}', session.workingDirectory)
    .replace('{date}', getCurrentDate())
    .replace('{os}', getOS())
    .replace('{tool_descriptions}', generateToolDescriptions(session.settings.enabledTools));
  
  // 2. 格式化對話歷史
  const history = formatConversationHistory(
    session.messages,
    { maxTokens: estimateAvailableTokens(systemPrompt) }
  );
  
  // 3. 取得當前請求（最新的 user message 或 tool result）
  const currentRequest = getLatestRequest(session.messages);
  
  // 4. 組裝完整提示詞
  const fullText = [systemPrompt, history, currentRequest]
    .filter(Boolean)
    .join('\n\n');
  
  return {
    fullText,
    sections: { systemPrompt, toolDescriptions, history, currentRequest },
    metadata: {
      estimatedTokens: estimateTokens(fullText),
      timestamp: Date.now(),
    },
  };
}
```

## 7. 針對不同 LLM 的適配

### 7.1 格式差異

| LLM | System Prompt 處理 | 工具呼叫格式偏好 |
|-----|-------------------|-----------------|
| ChatGPT | 支援 system role | 傾向 JSON function calling |
| Claude | 支援 system prompt | 傾向 XML 標記格式 |
| Gemini | 支援 system instruction | 傾向結構化格式 |

### 7.2 適配策略

系統提供「目標模型」設定選項。根據選擇的模型，組裝器會：
- 調整工具呼叫格式說明
- 調整提示詞的結構和措辭
- 顯示對應的 token 上限警告

預設使用通用格式（XML 標記），相容大多數模型。
