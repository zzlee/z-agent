# 工具定義與提示詞設計

## 1. 設計原則

參照 Pi (earendil-works/pi) 的簡潔工具設計：
- 工具數量精簡（Pi 預設僅 read、write、edit、bash 四個）
- 每個工具有清晰的 JSON Schema 定義參數
- 工具描述須足夠精確，讓 LLM 正確使用
- 工具回傳結構化結果

## 2. 工具清單

### 2.1 read — 讀取檔案

```json
{
  "name": "read",
  "description": "讀取指定檔案的內容。支援文字檔案的行範圍讀取。路徑可為相對路徑（相對於工作目錄）或絕對路徑。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "要讀取的檔案路徑（相對或絕對路徑）"
      },
      "offset": {
        "type": "number",
        "description": "起始行號（從 1 開始，選填）"
      },
      "limit": {
        "type": "number",
        "description": "最多讀取的行數（選填）"
      }
    },
    "required": ["path"]
  }
}
```

**執行邏輯**：
- 解析路徑（相對 → 絕對）
- 檢查檔案是否存在和可讀
- 讀取內容，套用 offset/limit
- 大檔案自動截斷（預設上限 2000 行或 200KB）
- 回傳附帶行號的內容

### 2.2 write — 寫入/建立檔案

```json
{
  "name": "write",
  "description": "將內容寫入指定檔案。如果檔案不存在會自動建立（包含父目錄）。如果檔案已存在則覆蓋。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "要寫入的檔案路徑"
      },
      "content": {
        "type": "string",
        "description": "要寫入的檔案內容"
      }
    },
    "required": ["path", "content"]
  }
}
```

**執行邏輯**：
- 解析路徑
- 自動建立不存在的父目錄
- 寫入檔案
- 回傳寫入的位元組數和路徑

### 2.3 edit — 編輯檔案

```json
{
  "name": "edit",
  "description": "對現有檔案進行精確的文字替換編輯。使用 old_string/new_string 配對來指定要替換的內容。old_string 必須在檔案中精確匹配（包含空白和縮排）。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "要編輯的檔案路徑"
      },
      "old_string": {
        "type": "string",
        "description": "要被替換的原始文字（必須精確匹配）"
      },
      "new_string": {
        "type": "string",
        "description": "替換後的新文字"
      }
    },
    "required": ["path", "old_string", "new_string"]
  }
}
```

**執行邏輯**：
- 讀取原始檔案
- 搜尋 old_string（必須唯一匹配）
- 如果有多個匹配，報錯要求更精確的 old_string
- 如果沒有匹配，報錯並顯示最接近的內容
- 執行替換並寫回檔案
- 回傳 diff 結果

### 2.4 bash — 執行命令

```json
{
  "name": "bash",
  "description": "在工作目錄下執行 bash 命令。命令會在 shell 中執行，支援管線和重導向。",
  "parameters": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "要執行的 bash 命令"
      },
      "timeout": {
        "type": "number",
        "description": "逾時秒數（選填，預設 30 秒）"
      }
    },
    "required": ["command"]
  }
}
```

**執行邏輯**：
- 在指定工作目錄下 spawn shell
- 捕獲 stdout 和 stderr
- 支援逾時控制
- 大輸出自動截斷
- 回傳 exit code、stdout、stderr

### 2.5 search — 搜尋檔案內容

```json
{
  "name": "search",
  "description": "在指定目錄中搜尋檔案內容。使用 grep 進行全文搜尋，支援正則表達式。",
  "parameters": {
    "type": "object",
    "properties": {
      "pattern": {
        "type": "string",
        "description": "搜尋模式（字串或正則表達式）"
      },
      "path": {
        "type": "string",
        "description": "搜尋目錄路徑（預設為工作目錄）"
      },
      "include": {
        "type": "string",
        "description": "檔案名稱 glob 過濾（如 '*.ts'）"
      }
    },
    "required": ["pattern"]
  }
}
```

## 3. 工具呼叫格式

### 3.1 在提示詞中的工具描述格式

提示詞組裝時，工具描述會以結構化方式呈現：

```
## Available Tools

You have the following tools available. To use a tool, respond with a tool_call block:

<tool_call name="TOOL_NAME">
{"param1": "value1", "param2": "value2"}
</tool_call>

### read
Read a file's contents. Supports line range reading.
Parameters:
- path (required): File path to read
- offset (optional): Starting line number (1-indexed)
- limit (optional): Maximum number of lines to read

### write
Write content to a file. Creates parent directories if needed.
Parameters:
- path (required): File path to write
- content (required): Content to write

### edit
Make exact text replacements in a file.
Parameters:
- path (required): File path to edit
- old_string (required): Exact text to replace (must match precisely)
- new_string (required): Replacement text

### bash
Execute a bash command in the working directory.
Parameters:
- command (required): Bash command to execute
- timeout (optional): Timeout in seconds

### search
Search for patterns in files using grep.
Parameters:
- pattern (required): Search pattern (string or regex)
- path (optional): Directory to search (default: working directory)
- include (optional): File name glob filter (e.g., '*.ts')
```

### 3.2 LLM 回應中的工具呼叫格式

LLM 應以下列格式回應工具呼叫：

```
我來看一下專案的設定檔。

<tool_call name="read">
{"path": "package.json"}
</tool_call>
```

### 3.3 工具結果回傳格式

工具執行完成後，結果會格式化為：

```
<tool_result name="read" status="success">
1: {
2:   "name": "my-project",
3:   "version": "1.0.0",
4:   ...
5: }
</tool_result>
```

或錯誤情況：

```
<tool_result name="read" status="error">
Error: File not found: package.json
</tool_result>
```

## 4. 工具安全規則

| 規則 | 說明 |
|------|------|
| 路徑限制 | read/write/edit 只能操作工作目錄下的檔案 |
| 命令限制 | bash 可配置白名單/黑名單 |
| 輸出截斷 | 超過 2000 行或 200KB 的輸出自動截斷 |
| 確認機制 | 所有工具呼叫都經使用者確認才執行 |
| 超時控制 | bash 命令預設 30 秒超時 |
