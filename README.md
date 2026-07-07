# Z-Agent

## 專案概述

Z-Agent 是一個**無內建 LLM、無 API 金鑰**的輕量級工具呼叫轉發閘道 (Tool-Use Relay Gateway)。

許多強大的 LLM（如 Gemini、ChatGPT、Claude 等）雖然具備 tool-use / function-calling 能力，但它們無法直接存取本地檔案系統或執行命令。Z-Agent 的角色非常單純——**只做轉發（relay）**：

1. **本機工具 Schema 輸出**：將可用工具（read、write、edit、bash、search）的定義與系統提示詞組裝成一份文字，供使用者手動複製給外部 LLM。
2. **LLM 回應接收與轉發執行**：使用者將 LLM 的回應（含 `<tool_call>` 標記）複製貼回 Z-Agent，系統解析出其中的工具呼叫，在本地依賴排序後執行，最後輸出結果。
3. **結果反饋**：執行完的工具結果格式化後輸出，使用者可複製回 LLM 對話中，形成下一輪循環。

整個過程不涉及 LLM API、不傳送資料到第三方、不需要金鑰設定——Z-Agent 僅作為**人機之間的轉發管道**。

---

## 快速開始

### 開發環境
啟動開發環境：
```sh
npm install
npm run dev
```

### 測試
執行測試：
```sh
npm test
```

### 建置與執行
```sh
npm run build
npm start
```

---

## 文件索引

| 文件 | 說明 |
|------|------|
| [00-overview.md](wiki/00-overview.md) | 專案概述 |
| [01-architecture.md](wiki/01-architecture.md) | 極簡前後端架構設計 |
| [02-agent-loop.md](wiki/02-agent-loop.md) | 轉發循環與 DAG 依賴執行 |
| [03-tools.md](wiki/03-tools.md) | 五大工具定義與使用格式 |
| [04-web-ui.md](wiki/04-web-ui.md) | Web 轉發控制台介面設計 |
| [05-data-model.md](wiki/05-data-model.md) | 會話資料模型與儲存 |
| [06-prompt-assembly.md](wiki/06-prompt-assembly.md) | 提示詞組裝變數機制 |
| [07-implementation-plan.md](wiki/07-implementation-plan.md) | 實施計畫 |
| [08-user-guide.md](wiki/08-user-guide.md) | 使用者操作與部署指南 |
| [09-cloudflare-deployment.md](wiki/09-cloudflare-deployment.md) | Cloudflare 部署可行性分析 |
