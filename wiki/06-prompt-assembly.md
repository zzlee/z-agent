# 提示詞組裝機制

## 1. 組裝原理

提示詞組裝器的目標是將所有必要的上下文打包成一段完整的文字，讓使用者可以直接複製貼到外部 LLM。

組裝結果包含四個區塊：
1. **System Prompt** — 角色設定 + 行為規範 + 工作目錄資訊
2. **Tool Descriptions** — 可用工具列表 + Schema + 呼叫格式
3. **Conversation History** — 之前的交互記錄（若有）
4. **Current Request** — 使用者最新指令或最新的工具執行結果

## 2. 系統提示詞模板

### 2.1 預設模板

模板以 Markdown 撰寫，包含以下變數：

| 變數 | 說明 | 範例 |
|------|------|------|
| `{cwd}` | 當前工作目錄 | `/home/user/project` |
| `{date}` | 當前日期 | `2026-07-07` |
| `{os}` | 作業系統 | `linux` |
| `{tool_descriptions}` | 工具描述區塊 | （自動生成） |

### 2.2 自訂模板

使用者在 `data/templates/` 下自訂模板，系統自動載入。

## 3. 呼叫格式說明

提示詞中告知 LLM 使用以下格式：

```
<tool_call name="TOOL_NAME">
{"param": "value"}
</tool_call>
```

多個工具呼叫可在同一個回應中連續發出。

## 4. Token 估算

| 語言 | 估算比例 |
|------|----------|
| 英文 | ~1 token / 4 字元 |
| 中文 | ~1 token / 1.5 字元 |
| 程式碼 | ~1 token / 3.5 字元 |

## 5. 組裝流程

```typescript
function assemblePrompt(session, messages, tools, template): AssembledPrompt {
  // 1. 填入系統提示詞模板
  const systemPrompt = template
    .replace('{cwd}', session.workingDirectory)
    .replace('{date}', getCurrentDate())
    .replace('{os}', getOS())
    .replace('{tool_descriptions}', generateToolDescriptions(tools));
  
  // 2. 格式化對話歷史
  const history = formatConversationHistory(messages);
  
  // 3. 取得當前請求
  const currentRequest = getLatestRequest(messages);
  
  // 4. 組裝
  const fullText = [systemPrompt, history, currentRequest]
    .filter(Boolean).join('\n\n');
  
  return { fullText, sections, estimatedTokens };
}
```
