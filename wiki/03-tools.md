# 工具定義與轉發格式

## 1. 設計原則

- 工具數量精簡，維持 LLM 可理解的最小集合（4 個）
- 每個工具有清晰的 JSON Schema
- 工具描述須足夠精確，讓 LLM 正確使用
- 工具呼叫格式統一使用 `<tool_call>` XML 標記
- 檔案搜尋由 LLM 自行透過 `bash` 工具呼叫 `rg` / `grep` / `find` 實現

## 2. 工具清單

### 2.1 read — 讀取檔案

```json
{
  "name": "read",
  "description": "Read the contents of a file. Supports line range reading. Path can be relative (to working directory) or absolute.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "File path to read (relative or absolute)" },
      "offset": { "type": "number", "description": "Starting line number (1-indexed, optional)" },
      "limit": { "type": "number", "description": "Maximum number of lines to read (optional)" }
    },
    "required": ["path"]
  }
}
```

### 2.2 write — 寫入/建立檔案

```json
{
  "name": "write",
  "description": "Write content to a file. Creates parent directories if they don't exist. Overwrites existing files.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "File path to write" },
      "content": { "type": "string", "description": "Content to write" }
    },
    "required": ["path", "content"]
  }
}
```

### 2.3 edit — 編輯檔案

```json
{
  "name": "edit",
  "description": "Make exact text replacements in a file. Uses old_string/new_string pair. old_string must match precisely (including whitespace and indentation).",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "File path to edit" },
      "old_string": { "type": "string", "description": "Exact text to replace (must match precisely)" },
      "new_string": { "type": "string", "description": "Replacement text" }
    },
    "required": ["path", "old_string", "new_string"]
  }
}
```

### 2.4 bash — 執行命令

```json
{
  "name": "bash",
  "description": "Execute a bash command in the working directory. Supports pipes and redirects. Use this for file searching (rg, grep, find), compilation, testing, and any CLI tools.",
  "parameters": {
    "type": "object",
    "properties": {
      "command": { "type": "string", "description": "Bash command to execute" },
      "timeout": { "type": "number", "description": "Timeout in seconds (optional, default 30)" }
    },
    "required": ["command"]
  }
}
```

> **注意**：系統不再內建 `search` 工具。檔案搜尋請透過 `bash` 工具呼叫 `rg`（ripgrep，已預先安裝）、`grep` 或 `find` 實現。

## 3. 轉發格式

### 3.1 系統提示詞中的工具描述

工具描述以結構化 Markdown 嵌入系統提示詞，供 LLM 理解可用工具及其呼叫方式：

```
## Available Tools

To use a tool, respond with a tool_call block:

<tool_call name="TOOL_NAME">
{"param1": "value1"}
</tool_call>

### read
Read a file's contents. Supports line range reading.
Parameters:
- path (required): File path to read
- offset (optional): Starting line number (1-indexed)
- limit (optional): Maximum lines to read
...
```

### 3.2 LLM 回應格式

LLM 應使用 `<tool_call>` 標記來發起工具呼叫：

```
<tool_call name="read">
{"path": "package.json"}
</tool_call>
```

多個工具呼叫可以在同一回應中發出，系統會自動進行依賴分析。

### 3.3 工具結果回傳格式

工具執行完成後，結果以 `<tool_result>` 回傳：

```
<tool_result>
{
  "toolCallId": "call_xxx",
  "toolName": "read",
  "status": "success",
  "content": "1: {\n  \"name\": \"my-project\"\n}"
}
</tool_result>
```

## 4. 安全規則

| 規則 | 說明 |
|------|------|
| 路徑限制 | read/write/edit 只能操作工作目錄下的檔案 |
| 命令限制 | bash 可配置白名單/黑名單 |
| 輸出截斷 | 超過 2000 行或 200KB 的輸出自動截斷 |
| 確認機制 | 所有工具呼叫都經使用者確認才執行 |
| 超時控制 | bash 命令預設 30 秒超時 |
