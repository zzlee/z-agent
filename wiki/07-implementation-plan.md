# 分階段實施計畫

## 實施概要

本文件定義 Z-Agent 的分階段開發計畫。每個階段都有明確的交付物和驗收標準。

---

## Phase 1：核心引擎（預計 2 週）

### 目標
建立最小可用的 Agent 引擎，能夠組裝提示詞、解析 LLM 回應，並分析多個工具呼叫之依賴關係以建立並行執行計畫。

### 交付物

| 模組 | 檔案 | 說明 |
|------|------|------|
| 工具定義 | `server/src/tools/read.ts` | read 工具實作 |
| 工具定義 | `server/src/tools/write.ts` | write 工具實作 |
| 工具定義 | `server/src/tools/edit.ts` | edit 工具實作 |
| 工具定義 | `server/src/tools/bash.ts` | bash 工具實作 |
| 工具定義 | `server/src/tools/search.ts` | search 工具實作 |
| 提示詞組裝 | `server/src/engine/prompt-assembler.ts` | 提示詞組裝器 |
| 回應解析 | `server/src/engine/response-parser.ts` | LLM 回應解析器 |
| 依賴分析 | `server/src/engine/dependency-planner.ts` | 工具執行計畫生成器 (分析依賴關係) |
| 狀態管理 | `server/src/engine/state.ts` | Agent 狀態管理 |
| 資料模型 | `server/src/types.ts` | TypeScript 型別定義 |

### 驗收標準
- [ ] 五個工具都能獨立執行和回傳結果
- [ ] 提示詞組裝器能正確生成包含工具描述的完整提示詞
- [ ] 回應解析器能從文字中提取工具呼叫指令
- [ ] 依賴分析模組能正確識別檔案讀寫與命令執行的依賴順序，生成 Stage 執行計畫
- [ ] 有單元測試覆蓋核心邏輯與依賴分析邏輯

---

## Phase 2：會話管理與 API（預計 2 週）

### 目標
建立會話持久化和 REST API 層。

### 交付物

| 模組 | 檔案 | 說明 |
|------|------|------|
| 會話儲存 | `server/src/session/session-store.ts` | JSONL 儲存實作 |
| 會話管理 | `server/src/session/session-manager.ts` | 會話 CRUD |
| API 路由 | `server/src/api/routes.ts` | REST API 端點 |
| WebSocket | `server/src/api/websocket.ts` | 即時更新推送 |
| 伺服器啟動 | `server/src/main.ts` | Express 伺服器 |
| 設定 | `data/config.json` | 預設設定檔 |
| 模板 | `data/templates/coding-assistant.md` | 預設提示詞模板 |

### API 端點

```
GET    /api/sessions              # 列出所有會話
POST   /api/sessions              # 建立新會話
GET    /api/sessions/:id          # 取得會話詳情
DELETE /api/sessions/:id          # 刪除會話

GET    /api/sessions/:id/prompt   # 取得當前組裝的提示詞
POST   /api/sessions/:id/message  # 提交使用者訊息
POST   /api/sessions/:id/response # 提交 LLM 回應
POST   /api/sessions/:id/execute  # 確認並執行工具呼叫
GET    /api/sessions/:id/status   # 取得當前狀態

GET    /api/templates             # 列出提示詞模板
GET    /api/config                # 取得設定
PUT    /api/config                # 更新設定
```

### 驗收標準
- [ ] 會話可以建立、讀取、恢復、刪除
- [ ] 訊息正確寫入 JSONL 檔案
- [ ] API 端點全部可用
- [ ] WebSocket 能推送狀態變更

---

## Phase 3：Web UI 基礎版（預計 3 週）

### 目標
建立功能完整的 Web 前端界面。

### 交付物

| 模組 | 檔案 | 說明 |
|------|------|------|
| HTML | `web/index.html` | 主頁面 |
| 樣式 | `web/css/main.css` | 主要樣式 |
| 樣式 | `web/css/components.css` | 元件樣式 |
| 應用邏輯 | `web/js/app.js` | 主應用程式 |
| API 客戶端 | `web/js/api-client.js` | API 呼叫封裝 |
| 元件 | `web/js/components/prompt-display.js` | 提示詞展示 |
| 元件 | `web/js/components/response-input.js` | 回應輸入 |
| 元件 | `web/js/components/tool-card.js` | 工具呼叫卡片 |
| 元件 | `web/js/components/session-sidebar.js` | 會話側邊欄 |
| 元件 | `web/js/components/status-bar.js` | 狀態列 |

### 核心功能
1. **會話管理**：新建、切換、刪除會話
2. **提示詞區域**：顯示組裝的提示詞、一鍵複製
3. **回應輸入**：貼上 LLM 回應、解析預覽
4. **工具呼叫確認**：顯示解析出的工具呼叫與執行計畫（分組顯示可並行執行的 Stage 與有順序依賴的工具）、提供逐一或批量確認
5. **並行執行可視化**：在執行中清晰展示正在並行執行的工具與等待執行的 Stage，並即時更新各工具執行進度與結果
6. **對話歷史**：聊天式呈現完整交互記錄
7. **狀態顯示**：底部狀態列顯示當前階段和 token 資訊

### 驗收標準
- [ ] 完整的新建任務到工具執行流程可運作
- [ ] 提示詞可一鍵複製
- [ ] LLM 回應可正確解析並顯示工具呼叫
- [ ] 顯示分析後的並行/依序執行計畫，且工具呼叫可確認/拒絕/修改
- [ ] 工具並行執行時，前端能即時且獨立渲染每個工具的進度與輸出
- [ ] 對話歷史正確顯示
- [ ] 響應式佈局（桌面 + 平板）

---

## Phase 4：進階功能（預計 2 週）

### 目標
增強使用體驗和擴展能力。

### 交付物

| 功能 | 說明 |
|------|------|
| 提示詞模板管理 | 建立、編輯、刪除自訂模板 |
| 多模型適配 | 針對 ChatGPT/Claude/Gemini 優化提示詞格式 |
| 會話分支 | 從任意歷史點建立分支 |
| 會話匯出 | 匯出為 Markdown / JSON / HTML |
| 歷史壓縮 | 長會話自動/手動壓縮（參照 Pi 的 /compact） |
| 安全設定 | Bash 白名單/黑名單、路徑限制設定介面 |
| 快捷鍵系統 | 鍵盤快捷鍵支援 |
| 深色模式 | UI 深色/淺色主題切換 |

### 驗收標準
- [ ] 自訂模板可建立和使用
- [ ] 不同模型的提示詞格式可正確切換
- [ ] 會話分支功能可運作
- [ ] 匯出檔案格式正確
- [ ] 壓縮後的會話可繼續使用

---

## Phase 5：打磨與部署（預計 1 週）

### 目標
優化效能、完善文件、準備部署。

### 交付物

| 項目 | 說明 |
|------|------|
| 使用者文件 | 操作手冊、快速入門指南 |
| 開發文件 | API 文件、擴展指南 |
| Docker | Dockerfile 和 docker-compose.yml |
| 測試 | 整合測試、端到端測試 |
| CI/CD | GitHub Actions 設定 |

### 驗收標準
- [ ] 使用者文件完整
- [ ] Docker 可一鍵部署
- [ ] 測試覆蓋率達到合理水準
- [ ] 無已知嚴重 Bug

---

## 技術選型總結

| 類別 | 選擇 | 理由 |
|------|------|------|
| 後端執行環境 | Node.js | 與 Pi 一致、工具生態豐富 |
| 後端框架 | Express | 簡單輕量、生態成熟 |
| 前端 | Vanilla JS + CSS | 零依賴、快速載入 |
| 資料儲存 | 檔案系統 (JSON/JSONL) | 簡單部署、無需資料庫 |
| 即時通訊 | WebSocket (ws) | 原生支援、低延遲 |
| 型別系統 | TypeScript | 參照 Pi、提升程式碼品質 |
| 容器化 | Docker | 一鍵部署 |

---

## 風險與緩解

| 風險 | 影響 | 緩解措施 |
|------|------|----------|
| LLM 回應格式不一致 | 解析失敗 | 容錯解析 + 手動編輯回應功能 |
| 複製貼上操作繁瑣 | 使用者體驗差 | 一鍵複製 + 快捷鍵 + 清晰指引 |
| 長會話 token 超限 | 無法繼續 | 歷史壓縮 + 分段提示詞 |
| 工具執行安全風險 | 系統損壞 | 確認機制 + 路徑限制 + 命令黑名單 |
| 不同 LLM 行為差異 | 工具呼叫格式不統一 | 多模型適配 + 解析容錯 |
