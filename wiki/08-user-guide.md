# Z-Agent 使用者操作手冊與 API 擴展指南

歡迎使用 Z-Agent！本手冊將指引您如何使用此人機協作平台，以及如何擴展與客製化其功能。

---

## 1. 快速開始

### 本地啟動步驟
1. 進入專案目錄：`cd z-agent`
2. 安裝依賴項目：`npm install`
3. 編譯 TypeScript：`npm run build`
4. 啟動伺服器：`npm run start`
5. 打開瀏覽器存取：[http://localhost:3000](http://localhost:3000)

### 使用 Docker 一鍵部署
1. 啟動容器：`docker-compose up -d --build`
2. 容器會自動將 `./data` (資料庫儲存) 與 `./workspace` (工作檔案夾) 掛載至本機，保存在容器重啟後資料不遺失。

---

## 2. 人機協作工作流程 (Cooperative Loop)

Z-Agent 沒有內建 LLM API，而是完全透過「複製貼上」的形式，與您電腦上的任意 LLM (如 Claude, ChatGPT) 進行完美對接。

```
[使用者輸入任務] ─(Z-Agent組裝)─> [📋 提示詞複製區] ──(複製貼上)──> [外部 LLM 網頁]
                                                                     │
[確認執行工具] <─(解析出計畫)── [📝 回應貼回區] <──(複製貼上)───────┘
```

### 詳細步驟：
1. **建立會話**：點擊 **+ 新會話**，輸入名稱，以及要操作的 CWD（工作目錄）。
2. **輸入任務**：在下方輸入框輸入指令（例如：`幫我建立一個 express 伺服器並寫入 src/server.ts`）。
3. **複製提示詞**：系統會自動組裝上下文，點擊右側的 **📋 複製提示詞**。
4. **外部 LLM 推理**：將剪貼簿內容貼給外部 LLM。LLM 會了解可用工具並生成包含 `<tool_call>` 的回覆。
5. **貼回回應**：將 LLM 的回覆完整複製，貼到 Z-Agent 的 **📝 回應貼回區**，點擊 **▶ 提交並解析回應**。
6. **執行工具計畫**：Z-Agent 解析出工具呼叫，並根據依賴關係進行分組展示。點擊 **▶ 執行確認計畫**，系統將在本機執行工具，完成後生成新提示詞，開始下一輪循環。

---

## 3. 進階操作

### ✂️ 對話分支 (Branching)
如果您對 LLM 目前產出的方案不滿意，或者想嘗試其他做法，您不需要重新開始：
1. 將滑鼠游標移到對話歷史中任意一則訊息（包含工具結果）上。
2. 點選氣泡右下角浮現的 **✂️ 建立分支** 按鈕。
3. 輸入新分支名稱，Z-Agent 會複製該時間點之前的歷史紀錄，並為您建立一個全新的獨立會話分支。

### ✂️ 歷史壓縮 (Compaction)
當對話輪次變多，提示詞長度逼近 LLM 限制時，您可以點選右上角的 **✂️ 壓縮歷史**：
1. 點擊 **📋 複製壓縮提示詞**，貼給外部 LLM。
2. LLM 會自動產生一份精簡的條列式歷史歷程摘要。
3. 將該摘要貼回第二個文字框，點擊 **▶ 執行歷史壓縮**。
4. 系統會清空舊有的大量歷史，替換為一則精簡的摘要通知，從而大幅釋放 Token 額度。

### ⚙️ 系統設定 (Settings)
點選右上角 **⚙️ 系統設定**，您可以動態修改：
- 伺服器 Host / Port。
- 預設 CWD 目錄。
- 使用的提示詞範本（例如切換成通用、程式碼或文件助理模板）。
- Bash 執行黑名單（例如禁止執行 `rm -rf /` 或 `sudo`）。

---

## 4. API 路由擴展

後端服務基於 Express 實作，端點統一以 `/api` 開頭：

| 方法 | 端點 | 說明 |
|------|------|------|
| `GET` | `/api/sessions` | 列出所有會話 |
| `POST` | `/api/sessions` | 建立新會話 |
| `GET` | `/api/sessions/:id` | 取得會話元資料與完整歷史 |
| `DELETE` | `/api/sessions/:id` | 刪除會話 |
| `GET` | `/api/sessions/:id/prompt` | 取得當前組裝提示詞 |
| `POST` | `/api/sessions/:id/message` | 傳送使用者輸入 |
| `POST` | `/api/sessions/:id/response` | 傳送 LLM 回應並解析計畫 |
| `POST` | `/api/sessions/:id/execute` | 執行確認計畫 |
| `POST` | `/api/sessions/:id/branch` | 分支會話 |
| `GET` | `/api/templates` | 列出可用模板 |
| `GET` | `/api/config` | 讀取設定檔 |
| `PUT` | `/api/config` | 寫入設定檔 |
| `POST` | `/api/sessions/:id/compact/prompt` | 產生壓縮用提示詞 |
| `POST` | `/api/sessions/:id/compact/submit` | 提交壓縮結果 |
