# Z-Agent

A minimal [MCP](https://modelcontextprotocol.io) server that exposes four tools — `bash`, `read`, `write`, and `edit` — over **Streamable HTTP**. The tool design follows the [pi coding agent](https://github.com/earendil-works/pi): four tools are all a coding agent needs.

There is no relay loop, no session UI, and no authentication. The server runs commands and edits files with the privileges of the user who launched it.

## Tools

| Tool | Parameters | Description |
|---|---|---|
| `read` | `path`, `offset?`, `limit?` | Read a text file as line-numbered (`<line>: <content>`) text (default first 2000 lines). Do not copy the line-number prefixes into `edit`. |
| `write` | `path`, `content` | Create or completely overwrite a file; creates parent directories. Use `edit` for partial changes to avoid data loss. |
| `edit` | `path`, `oldText`, `newText` | Replace an exact, unique string in a file. Pass `newText=""` to delete code. |
| `bash` | `command`, `timeout?` | Run a non-interactive bash command; returns stdout+stderr and exit code. Each call is a fresh subshell, so `cd` does not persist (use `cd dir && cmd`). |

Paths may be absolute or relative to the server's working directory; a leading `~` is expanded to the home directory.

## Requirements

- Node.js >= 18

## Build & run

```sh
npm install
npm run build
npm start
```

The server listens on `http://127.0.0.1:3000` and serves the MCP endpoint at `/mcp`.

### Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Keep it on localhost unless you know what you are doing. |
| `PORT` | `3000` | Listen port. |
| `MCP_PATH` | `/mcp` | HTTP path of the MCP endpoint. |

```sh
HOST=0.0.0.0 PORT=8080 npm start
```

`GET /health` returns `{"status":"ok"}` for liveness checks.

## Development

```sh
npm run dev        # tsx watch
npm test           # unit + in-memory end-to-end tests
npm run typecheck  # tsc --noEmit
```

## Connecting an MCP client

The transport is Streamable HTTP, so clients connect to a URL rather than spawning a process. Example client configuration:

```json
{
  "mcpServers": {
    "z-agent": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Launch the server from the directory you want the tools to operate on, because relative paths and `bash` use the server's current working directory.

## Expose via Tailscale

`scripts/serve-tailscale.sh` wraps `tailscale serve`/`funnel` so other devices can reach the server at its MagicDNS HTTPS URL.

```sh
AUTO_START=1 ./scripts/serve-tailscale.sh     # tailnet only (recommended)
./scripts/serve-tailscale.sh funnel           # PUBLIC internet — no auth, beware
./scripts/serve-tailscale.sh reset            # stop exposing
```

It configures a proxy from the external HTTPS URL to `http://127.0.0.1:3000` and prints the endpoint, e.g.:

```
external  : https://bill-dev.taila06758.ts.net/mcp
```

Notes:

- Writing the Tailscale serve config requires root. The script sets you as the Tailscale operator once (`sudo tailscale set --operator=$USER`) so later runs need no privileges. Disable with `TS_OPERATOR=0`.
- Requires HTTPS certificates enabled for your tailnet (admin console → DNS → HTTPS Certificates).
- `serve` is private to your tailnet; `funnel` is public. Since this server has no authentication, prefer `serve`.

> **Known issue:** `tailscale funnel` is currently broken on recent Tailscale versions — the funnel reports `Funnel on` and certificates issue fine, but the public `<node>.<tailnet>.ts.net` name is never published to public DNS (authoritative `ts.net` servers return NODATA), so the internet cannot resolve or reach it. See [tailscale/tailscale#21698](https://github.com/tailscale/tailscale/issues/21698). Use the ngrok option below if you need a public URL today.

## Expose on a stable public URL via ngrok

`scripts/serve-ngrok.sh` runs an [ngrok](https://ngrok.com) tunnel on your account's free **dev domain**, giving a public HTTPS URL that does **not change** between restarts (unlike the random `*.ngrok-free.app` URL you get without `--url`).

One-time setup:

1. Create a free account at <https://dashboard.ngrok.com>.
2. Copy the authtoken from <https://dashboard.ngrok.com/get-started/your-authtoken> and run
   `~/.local/bin/ngrok config add-authtoken <TOKEN>`.
3. Claim your dev domain at <https://dashboard.ngrok.com/domains> (looks like `xxxx-yyyy-zzzz.ngrok-free.dev`).

Then:

```sh
DOMAIN=<your>.ngrok-free.dev AUTO_START=1 ./scripts/serve-ngrok.sh   # start / restart
./scripts/serve-ngrok.sh status                                      # show the URL
./scripts/serve-ngrok.sh stop                                        # stop the tunnel
```

It prints the endpoint, e.g.:

```
external  : https://subcarinate-juelz-heliographically.ngrok-free.dev/mcp
```

> The ngrok tunnel exposes the server to the **entire public internet** with no authentication. Anyone who learns the URL can run shell commands and edit files on this machine.

## Security

This server is intentionally **YOLO**:

- `bash` can execute any command with your full user privileges.
- `write` and `edit` can modify any file your user can access.
- There is **no authentication** and **no allow-list**.

Because the server can both read data and execute code, the only meaningful isolation is the environment it runs in. Run it inside a container or a dedicated sandbox, bind it to `127.0.0.1`, and never expose it to an untrusted network. Authentication and permission controls are planned as future work.

## License

See repository for details.
