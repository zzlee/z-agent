# Z-Agent 使用者操作指南

Z-Agent 是一個 LLM Tool-Use 轉發閘道。本指南說明如何使用此工具。

---

## 1. 快速開始

### 啟動
```bash
cd z-agent
npm install
npm run build
npm run start
```

打開瀏覽器：**http://localhost:3000**

### 使用 Docker
```bash
docker-compose up -d --build
```

---

## 2. 轉發工作流程

Z-Agent 的核心操作循環只有 4 個步驟：

### Step 1：輸入任務
在會話中輸入您的需求（例如「幫我閱讀 package.json 並分析依賴關係」）。系統會自動組裝提示詞。

### Step 2：複製提示詞給 LLM
點擊 **📋 複製提示詞**，切換到外部 LLM（Claude、ChatGPT、Gemini 等），將提示詞貼上。

### Step 3：貼回 LLM 回應
LLM 回應後，複製其完整回應（包含 `<tool_call>` 標記），貼回 Z-Agent 的 **📝 回應貼回區**，點擊 **▶ 提交並解析回應**。

### Step 4：執行工具
系統會解析出 LLM 發起的工具呼叫，並按依賴關係分組顯示。檢視後點擊 **▶ 執行確認計畫**，工具就會在本地執行。

執行完成後，結果會顯示在 **📋 複製工具執行結果** 區塊。複製結果貼回 LLM，即可繼續下一輪。

---

## 3. 操作示意

```
[Z-Agent]                        [外部 LLM]
    │                                │
    ├── 組裝提示詞                    │
    ├── [📋 複製] ──────────────►    │
    │                                ├── LLM 回應
    │    ◄──────────────── [貼回] ──┤
    ├── 解析 tool_call               │
    ├── [▶ 執行]                     │
    ├── 顯示結果                     │
    ├── [📋 複製結果] ──────────►   │
    │                                ├── 繼續推理
    │    ◄──────────────── [貼回] ──┤
    └── (循環)                       │
```

---

## 4. 工具說明

| 工具 | 用途 | 範例 |
|------|------|------|
| read | 讀取檔案內容 | `<tool_call name="read">{"path":"src/index.ts"}</tool_call>` |
| write | 寫入/建立檔案 | `<tool_call name="write">{"path":"app.js","content":"..."}</tool_call>` |
| edit | 精確替換文字 | `<tool_call name="edit">{"path":"app.js","old_string":"old","new_string":"new"}</tool_call>` |
| bash | 執行指令（含搜尋） | `<tool_call name="bash">{"command":"rg import --glob *.ts"}</tool_call>` |

---

## 5. 常見問題

**Q: LLM 回應中的 tool_call 沒被正確解析？**
A: 確認 LLM 回應中確實包含 `<tool_call name="...">...</tool_call>` 格式的區塊。部分 LLM 可能使用不同的格式，可手動調整後重新貼上。

**Q: 工具執行失敗怎麼辦？**
A: Z-Agent 會將錯誤資訊格式化為 tool_result，您可以直接複製給 LLM，讓 LLM 自行修正。

**Q: 對話太長怎麼辦？**
A: 直接建立一個新的會話，在新會話中提供必要的上下文即可。
