# Z-Agent 重構計劃書（v3-final）

> **目標**:把整個專案徹底改成一個 **MCP server(Streamable HTTP)**,對外提供 `bash` / `read` / `write` / `edit` 四個工具。
> 不需要 workspace / data 參數、不需要認證、不需要 relay / session / Web UI。
> 先打通 server,認證日後再議。

## 已鎖定的決策

| 項目 | 決策 |
|---|---|
| 傳輸 | **Streamable HTTP**(`StreamableHTTPServerTransport` + `node:http`) |
| 端點 | `POST/GET/DELETE /mcp`(stateful,session map);`GET /health` |
| 綁定位址 | 預設 `127.0.0.1:3000`(可用 `HOST`/`PORT` 覆蓋) |
| 工具 | `bash` / `read` / `write` / `edit`,schema 對齊 pi |
| `edit` 參數 | `path` / `oldText` / `newText` |
| 認證 | 無(預設只綁 localhost) |
| 安全 | YOLO(不黑名單),README 明確聲明完整權限 |
| 刪除 | 全部 relay 時代檔案 + `express`/`ws` 依賴 + Dockerfile/docker-compose |

## 對外工具規格

### read
- `path`(string,必填)、`offset`(int,1-indexed,預設 1)、`limit`(int,預設 2000)
- 輸出帶行號;截斷 2000 行 / 200KB。

### write
- `path`(string,必填)、`content`(string,必填);自動建立父目錄、覆寫。

### edit
- `path`、`oldText`、`newText`(皆必填);`oldText` 須在檔案中唯一,否則報錯。

### bash
- `command`(string,必填)、`timeout`(int 秒,預設 120,上限 600)
- 合併 stdout + stderr,附 exit code;輸出截斷 100KB。

## 檔案結構

```
src/
  index.ts        # HTTP server、/mcp 路由、session 管理
  server.ts       # createMcpServer():註冊四工具的 factory(可測試)
  tools/{read,write,edit,bash}.ts
  lib/{paths,truncate,shell,result}.ts
  test/{tools,server}.test.ts
README.md
package.json  tsconfig.json  vitest.config.ts
```

## 依賴

- `dependencies`: `@modelcontextprotocol/sdk`, `zod`
- `devDependencies`: `@types/node`, `tsx`, `typescript`, `vitest`
- 移除:`express`、`ws`、`@types/express`、`@types/ws`

## 里程碑

1. **M1** 專案骨架轉型(刪舊檔、改設定、建立 index/server 骨架)
2. **M2** 四工具實作(Zod schema + helper)
3. **M3** 測試(單元 + InMemoryTransport 端到端)
4. **M4** README 與安全聲明

## 關鍵注意

- Streamable HTTP 以 HTTP body/SSE 承載協議;所有 log 一律走 stderr(`console.error`)。
- 預設只綁 `127.0.0.1`,避免無認證服務意外暴露到區網。
