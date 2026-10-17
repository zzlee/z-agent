# Z-Agent MCP 工具描述與防誤用優化執行計劃書

> **文件名稱**：`TOOL_IMPROVEMENT_PLAN.md`  
> **制定日期**：2026-10-17  
> **修訂日期**：2026-10-17（v2：修正「變更重點 vs 預期變更」不一致、釐清實際改動範圍、補齊邊界測試與成效指標）  
> **目標系統**：Z-Agent Standalone MCP Server (`src/tools/*`)  
> **負責人**：Z-Agent 維護者  
> **核心目標**：強化 `bash`、`read`、`write`、`edit` 四項工具的提示說明（Description）與參數定義（Zod Schema），**降低**（而非宣稱「消除」）LLM 在呼叫工具時的高頻誤用與踩坑點，提高 Agent 一次命中的成功率。

---

## 1. 計劃背景與目標

Z-Agent 已成功重構為基於 Streamable HTTP 的輕量獨立 MCP Server，對外提供 `bash`、`read`、`write`、`edit` 四大基礎能力。
經代碼審查與實際 Agent 調用評估，工具的底層防禦（如 `PAGER=cat`、`stdio: ['ignore', ...]`、位元組截斷保護、唯一性比對）均已就緒，但在**自然語言指示層**，LLM 容易因提示不明確而產生以下高頻錯誤：

1. **`bash` subshell 假定持續性**：LLM 先執行 `cd <目錄>`，以為後續 Tool Call 會保留工作目錄。
2. **`bash` 誤判非 0 結束碼為崩潰**：`grep`（無匹配）、`diff`（有差異）等指令非 0 結束碼屬正常行為，LLM 卻誤認為系統失敗。
3. **`read` 與 `edit` 的行號干擾**：`read` 輸出的 `<line>: ` 前綴被模型複製到 `edit` 的 `oldText` 中，造成字串比對失敗。
4. **`write` 的覆寫災難（Wipeout）**：模型欲局部修改檔案卻誤用 `write` 只傳入修改片段，導致原檔案其餘內容被覆蓋抹除。
5. **`edit` 的代碼刪除不明確**：模型不清楚如何刪除代碼（傳入空字串 `newText: ""`），或 context 抓取不足導致多次比對失敗。

> **範圍界定（重要）**：本計劃為**提示層（prompt/description 層）優化**，僅調整工具 `description` 與 Zod `.describe()` 文字，**不改變任何執行邏輯**。若要進一步「防護」，屬於後續獨立計劃（見 §6）。

---

## 2. 實際改動範圍（與現行 `src/tools/*` 之逐項對照）

為避免誇大工作量，以下標示每一項的實際變更型態：

| 檔案 | 變更欄位 | 型態 | 說明 |
|---|---|---|---|
| `bash.ts` | `bashInputSchema.command.describe` | **修改** | 加入 subshell / `cd` 不持久 / 非互動說明 |
| `bash.ts` | `registerBashTool` description | **修改** | 加入 `cd` 不持久與非 0 結束碼語意 |
| `read.ts` | `readInputSchema`（path/offset/limit） | **不變** | 與現行相同，僅確認 |
| `read.ts` | `registerReadTool` description | **修改** | 加入行號前綴警告、標註文字檔、保留路徑說明 |
| `write.ts` | `writeInputSchema.content.describe` | **修改** | 強調「完整內容」與「完整覆寫」 |
| `write.ts` | `registerWriteTool` description | **修改** | 加入 WARNING 與改用 `edit` 的引導 |
| `edit.ts` | `editInputSchema.oldText.describe` | **修改** | 加入「勿含 `read` 行號前綴」 |
| `edit.ts` | `editInputSchema.newText.describe` | **修改** | 加入「空字串 = 刪除」 |
| `edit.ts` | `registerEditTool` description | **修改** | 加入刪除語意與行號提醒 |

---

## 3. 工具修訂規格與程式碼變更

> 以下程式碼即為本次要落地的**最終版本**（與 §2 對照表一致）。

### 3.1 `src/tools/bash.ts`

#### 變更重點
* 明確宣告：每個指令皆在獨立 subshell 執行，`cd` 不會跨調用持久（引導使用 `cd dir && cmd`）。
* 明確宣告：指令必須為非互動式（禁止任何等待使用者輸入的指令）。
* 明確宣告：**非 0 結束碼會被回報為 error，但這往往是工具的預期行為**（如 `grep` 無匹配、`diff` 有差異），不代表系統崩潰。

#### 最終程式碼
```typescript
export const bashInputSchema = {
  command: z
    .string()
    .describe(
      'The shell command to execute via `bash -c`. Runs in a fresh subshell in the server working directory; directory changes (`cd`) do NOT persist between calls (use `cd dir && cmd` instead). Must be non-interactive (avoid commands that wait for user input).'
    ),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(MAX_TIMEOUT_SEC)
    .optional()
    .describe(
      `Timeout in seconds. Defaults to ${DEFAULT_TIMEOUT_SEC}, maximum ${MAX_TIMEOUT_SEC}.`
    ),
};

export function registerBashTool(server: McpServer): void {
  server.registerTool(
    'bash',
    {
      title: 'Run bash command',
      description:
        'Execute a shell command in the server working directory and return its combined stdout/stderr together with the exit code. Each call runs non-interactively in a fresh subshell, so directory changes (`cd`) do NOT persist between calls — use `cd dir && cmd` instead. A non-zero exit code is reported as an error but is often normal tool behavior (e.g. `grep` with no match, `diff` showing differences).',
      inputSchema: bashInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    runBash
  );
}
```

### 3.2 `src/tools/read.ts`

#### 變更重點
* 特別提醒：輸出帶有行號前綴（例如 `1: <code>`），在將文字貼到 `edit` 工具時**切勿包含行號**。
* 標註僅適用文字檔案，避免二進位檔案誤讀。
* 保留「路徑可為相對或絕對」的資訊（不放棄原有資訊量）。

#### 最終程式碼
```typescript
export function registerReadTool(server: McpServer): void {
  server.registerTool(
    'read',
    {
      title: 'Read file',
      description:
        'Read the contents of a text file as line-numbered text (not intended for binary files). Output lines are formatted as "<line>: <content>". For large files, use offset/limit to read a specific range. Paths may be relative to the server working directory or absolute. IMPORTANT: Do NOT include the "<line>: " prefixes when copying text into the "edit" tool.',
      inputSchema: readInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    runRead
  );
}
```
（`readInputSchema` 維持不變。）

### 3.3 `src/tools/write.ts`

#### 變更重點
* 強烈警告：`write` 會**完整覆寫**目標檔案，若要修改部分內容應使用 `edit`，防範殘缺程式碼覆蓋完整檔案。

#### 最終程式碼
```typescript
export const writeInputSchema = {
  path: z
    .string()
    .describe(
      'Path to the file to write. May be relative to the server working directory or absolute. A leading "~" is expanded to the home directory.'
    ),
  content: z
    .string()
    .describe(
      'The entire file content to write. Completely overwrites any existing content.'
    ),
};

export function registerWriteTool(server: McpServer): void {
  server.registerTool(
    'write',
    {
      title: 'Write file',
      description:
        'Create a new file or completely overwrite an existing file with the given content. Parent directories are created automatically. WARNING: This replaces the entire file content. To make partial modifications, use the "edit" tool instead to avoid data loss.',
      inputSchema: writeInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    runWrite
  );
}
```

### 3.4 `src/tools/edit.ts`

#### 變更重點
* 明確說明：`oldText` 必須為檔案原始內容，不得帶有 `read` 工具產生的行號前綴。
* 明確說明：刪除程式碼時將 `newText` 設為空字串 `""`。
* 提示若發生多次匹配時應擴大周圍上下文（surrounding lines）。

> **已知邊界**：`runEdit` 於 `oldText === newText` 時會回報「無變更」。當兩者同為空字串時亦會觸發此守衛；實務上 `oldText` 為空即無意義，故不另行處理，僅在此記錄。

#### 最終程式碼
```typescript
export const editInputSchema = {
  path: z
    .string()
    .describe(
      'Path to the file to edit. May be relative to the server working directory or absolute. A leading "~" is expanded to the home directory.'
    ),
  oldText: z
    .string()
    .describe(
      'The exact text to find. Must match the file byte-for-byte, including exact whitespace and indentation, and must occur exactly once. Do NOT include the "<line>: " prefixes produced by the "read" tool.'
    ),
  newText: z
    .string()
    .describe(
      'The text to replace oldText with. Pass an empty string ("") to delete oldText from the file.'
    ),
};

export function registerEditTool(server: McpServer): void {
  server.registerTool(
    'edit',
    {
      title: 'Edit file',
      description:
        'Replace an exact unique string in a file with new text. oldText must match byte-for-byte (excluding any line-number prefixes from the "read" tool) and occur exactly once; if it is ambiguous, include more surrounding lines to make it unique. Pass newText="" to delete code. Use this for precise, surgical edits instead of rewriting whole files.',
      inputSchema: editInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    runEdit
  );
}
```

---

## 4. 測試驗證計劃 (`src/test/tools.test.ts`)

修訂後執行既有測試並追加邊界測試。**明確聲明**：這些測試驗證的是**工具行為**，並非驗證「描述文字是否真的改善 LLM 誤用率」（後者見 §5）。

追加案例：

1. **`edit` 刪除功能測試**：`newText: ""` 可正常將 `oldText` 移除且不留下殘餘。
2. **`edit` 多行縮排替換測試**：驗證多行／含縮排程式碼替換正常。
3. **`edit` 行號前綴防呆測試**：`oldText` 帶 `read` 行號前綴時應比對失敗（反向驗證 §3.2 的提醒）。
4. **`bash` subshell 行為測試**：單獨 `cd` 不跨調用持久；`cd dir && cmd` 可生效（驗證 §3.1 的承諾）。
5. **`write` 覆寫縮減測試**：以片段覆寫會使檔案內容縮減（守門測試，佐證「局部修改應改用 `edit`」）。
6. **既有測試全數通過**：`npm test` 維持既有 15 項單元測試與 server 端到端測試 100% 通過（預期追加後為 20 項單元測試）。

```typescript
// 追加至 src/test/tools.test.ts
it('deletes code when newText is an empty string', async () => {
  await fs.writeFile(join(testDir, 'delete.txt'), 'line1\nline2\nline3', 'utf8');
  const res = await runEdit({ path: 'delete.txt', oldText: 'line2\n', newText: '' });
  expect(res.isError).toBeFalsy();
  expect(await fs.readFile(join(testDir, 'delete.txt'), 'utf8')).toBe('line1\nline3');
});

it('replaces multi-line indented code', async () => {
  await fs.writeFile(join(testDir, 'code.ts'), 'function f() {\n  return 1;\n}\n', 'utf8');
  const res = await runEdit({ path: 'code.ts', oldText: '  return 1;', newText: '  return 2;' });
  expect(res.isError).toBeFalsy();
  expect(await fs.readFile(join(testDir, 'code.ts'), 'utf8')).toBe(
    'function f() {\n  return 2;\n}\n'
  );
});

it('does not match when oldText includes read line-number prefixes', async () => {
  await fs.writeFile(join(testDir, 'numbered.txt'), 'alpha\nbeta', 'utf8');
  const res = await runEdit({ path: 'numbered.txt', oldText: '1: alpha', newText: 'x' });
  expect(res.isError).toBe(true);
  expect(textOf(res)).toContain('Could not find');
});

it('does not persist cd between calls but honors cd && cmd', async () => {
  await fs.mkdir(join(testDir, 'subdir'), { recursive: true });
  await runBash({ command: 'cd subdir' });
  const persisted = await runBash({ command: 'pwd' });
  expect(textOf(persisted)).toContain(testDir);
  const chained = await runBash({ command: 'cd subdir && pwd' });
  expect(textOf(chained)).toContain(join(testDir, 'subdir'));
});

it('overwrites (shrinks) content completely', async () => {
  await runWrite({ path: 'guard.txt', content: 'aaaa\nbbbb\ncccc\n' });
  await runWrite({ path: 'guard.txt', content: 'bbbb\n' });
  expect(await fs.readFile(join(testDir, 'guard.txt'), 'utf8')).toBe('bbbb\n');
});
```

---

## 5. 成效指標與驗證方式

本次為提示層優化，需以「可量測」方式輔助判斷成效，避免只靠主觀感受：

| 指標 | 方法 | 目標 |
|---|---|---|
| 工具行為不回歸 | `npm test` + `npm run typecheck` | 100% 通過 |
| 誤用率下降 | 以固定任務集（如「改檔案中的一行」「讀取後局部編輯」「切換目錄後執行」）各跑 N 次，統計首次命中率 | 相對優化前提升 |
| 描述可讀性 | 人工抽查 `MCP tools/list` 輸出，確認無矛盾與過長 | 無自相矛盾 |

> 若無法立即建立自動化 eval，至少以人工 A/B 記錄「優化前後」的誤用次數作為最低限度佐證。

---

## 6. 後續計劃（非本次範圍，僅記錄）

以下屬「行為層防護」，與本提示層優化分開評估，不在本次落地：

* **`write` 覆寫保護**：偵測到既有檔案且新內容明顯短於舊內容時，於回應中附加警示（或要求顯式覆寫旗標）。
* **`bash` 結束碼語意**：評估是否對「常見非錯誤的非 0 結束碼」提供更明確的訊息格式。
* **`edit` 行號自動剝除**：偵測常見 `<n>: ` 前綴並提示或自動修正（有誤刪風險，需審慎）。

---

## 7. 執行里程碑與檢查清單

- [ ] **Phase 1: 更新程式碼**
  - [ ] 修訂 `src/tools/bash.ts` 描述與 Schema（含非 0 結束碼說明）。
  - [ ] 修訂 `src/tools/read.ts` 描述（`readInputSchema` 不變）。
  - [ ] 修訂 `src/tools/write.ts` 描述與 content Schema。
  - [ ] 修訂 `src/tools/edit.ts` 描述與 oldText/newText Schema。
- [ ] **Phase 2: 擴充單元測試與驗證**
  - [ ] 在 `src/test/tools.test.ts` 新增 §4 五項邊界測試。
  - [ ] 執行 `npm test` 與 `npm run typecheck`，確認全數 PASS。
- [ ] **Phase 3: 同步說明文件與 Git 提交**
  - [ ] 更新 `README.md` 中的工具說明章節。
  - [ ] 提交 Commit：`docs(tools): clarify tool descriptions and guard against LLM misuses`。
