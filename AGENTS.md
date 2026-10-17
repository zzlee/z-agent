# AGENTS.md

This file provides context, architectural rules, and workflow guidelines for coding agents working in the **Z-Agent** (`z-agent`) repository.

## 1. Project Overview & Design Philosophy

**Z-Agent** is a minimal standalone [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server over **Streamable HTTP**, inspired by the [pi coding agent](https://github.com/earendil-works/pi) philosophy: *four tools (`bash`, `read`, `write`, `edit`) are all a coding agent needs.*

- **Minimalist Stack**: Built on Node.js (`>= 18`), native `node:http`, `@modelcontextprotocol/sdk` (`StreamableHTTPServerTransport`), and `zod`.
- **No Bloat**: There is no Express server, no WebSocket relay loop, no browser UI, and no complex session database. Keep runtime dependencies strictly minimal.
- **Security Model ("YOLO" by Design)**: The server executes commands and modifies files with the full privileges of the user who launched it, without built-in authentication or path sandboxing. By default, it binds only to `127.0.0.1:3000`.

## 2. Repository Structure

```text
src/
  index.ts              # HTTP server entry point (/mcp Streamable HTTP routing, session map, GET /health)
  server.ts             # createMcpServer() factory registering the 4 tools (decoupled for testing)
  tools/
    bash.ts             # bash tool: non-interactive subshell execution, timeout & output truncation
    read.ts             # read tool: 1-indexed line-numbered text file reader with offset/limit
    write.ts            # write tool: full file creation/overwrite with auto mkdir -p
    edit.ts             # edit tool: exact unique string replacement (supports deletion via newText="")
  lib/
    paths.ts            # expandTilde() and resolvePath() (relative to process.cwd(), absolute, or ~)
    truncate.ts         # truncateContent() by UTF-8 byte boundary and line count
    shell.ts            # resolveShellPath() for POSIX (/bin/bash, /usr/bin/bash, /bin/sh) & Windows
    result.ts           # textResult(), errorResult() (isError: true), and errorMessage() helpers
  test/
    tools.test.ts       # Unit tests for runRead, runWrite, runEdit, runBash in a temp working dir
    server.test.ts      # End-to-end MCP client-server tests via InMemoryTransport
scripts/
  serve-tailscale.sh    # Expose local server over Tailscale Serve / Funnel
  serve-ngrok.sh        # Expose local server over a stable ngrok dev domain
```

## 3. Essential Commands

Run all commands from the repository root:

| Task | Command | Notes |
| :--- | :--- | :--- |
| **Run tests** | `npm test` | Runs `vitest run` (unit tests + `InMemoryTransport` E2E tests) |
| **Typecheck** | `npm run typecheck` | Runs `tsc --noEmit` in strict mode |
| **Build** | `npm run build` | Compiles `src/` (excluding `*.test.ts`) to `dist/` |
| **Dev mode** | `npm run dev` | Runs `tsx watch src/index.ts` |
| **Start prod** | `npm start` | Runs `node dist/index.js` (`HOST=127.0.0.1`, `PORT=3000`, `MCP_PATH=/mcp`) |

## 4. Coding Conventions & Architecture Guidelines

1. **TypeScript & ESM (`NodeNext`)**:
   - The project uses `"type": "module"` and `"moduleResolution": "NodeNext"`.
   - **Always include `.js` extensions** in relative TypeScript imports (e.g., `import { resolvePath } from '../lib/paths.js';`).
   - Maintain strict type safety (`"strict": true`); avoid `any` in production code (`src/tools/*`, `src/lib/*`, `src/index.ts`, `src/server.ts`).

2. **Tool Implementation Pattern (`src/tools/*.ts`)**:
   Each tool file should consistently export:
   - `<name>InputSchema`: Raw Zod shape object with clear `.describe()` prompts for every field.
   - `<Name>Args`: TypeScript interface matching the schema.
   - `run<Name>(args: <Name>Args)`: Standalone async function returning a `CallToolResult` via `textResult()` or `errorResult()`. **Never throw unhandled exceptions** out of tool handlers; catch errors and return `errorResult(...)` so the MCP client model receives actionable feedback.
   - `register<Name>Tool(server: McpServer)`: Registers the tool on `McpServer` with `title`, `description`, `inputSchema`, and accurate `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).

3. **Tool Semantics & LLM Guardrails** (see `TOOL_IMPROVEMENT_PLAN.md`):
   - **`bash`**: Spawns with `stdio: ['ignore', 'pipe', 'pipe']` and `PAGER: 'cat'` so commands never hang waiting for interactive input. Each invocation is a fresh subshell (`cd` does not persist across calls). Output is capped at `100 KB` / `100,000` lines. Non-zero exit codes return `errorResult` (`isError: true`).
   - **`read`**: Returns `<line>: <content>` (1-indexed), capped at `2000` lines / `200 KB`. Descriptions must remind callers **not** to copy `<line>: ` prefixes into `edit`.
   - **`write`**: Overwrites the entire file and creates parent directories. Descriptions must warn callers to use `edit` for partial edits to prevent accidental file wipeouts.
   - **`edit`**: Requires `oldText` to match byte-for-byte **exactly once** (`content.split(oldText).length === 2`) and rejects `oldText === newText`. Supports `newText: ""` for deleting code.

4. **Logging & Transport**:
   - Write all server logs to `stderr` (`console.error`), never `stdout`.
   - Keep `createMcpServer()` in `src/server.ts` pure and transport-agnostic so each HTTP session in `src/index.ts` and each test in `src/test/server.test.ts` can instantiate an isolated `McpServer`.

## 5. Agent Workflow & Verification Checklist

Before committing or finishing any change:

1. **Verify Types & Tests**: Run `npm run typecheck && npm test` (and `npm run build` if modifying exports or build configuration). All checks must pass with zero errors.
2. **Add/Update Tests**:
   - Tool logic or schema changes must be covered in `src/test/tools.test.ts` and/or `src/test/server.test.ts`.
   - Notice that `src/test/tools.test.ts` chdirs into a temporary directory (`mkdtempSync`) during tests—keep file fixtures self-contained inside `testDir`.
3. **Commit Message Style**: Follow concise Conventional Commits (e.g., `feat(tools): ...`, `fix(server): ...`, `docs(tools): ...`, `refactor: ...`, `test: ...`).
