#!/usr/bin/env bash
#
# serve-ngrok.sh — expose the local z-agent MCP server on a STABLE public URL via ngrok.
#
# Usage:
#   ./scripts/serve-ngrok.sh            # start (or restart) the tunnel   [default]
#   ./scripts/serve-ngrok.sh status     # show the current tunnel + URL
#   ./scripts/serve-ngrok.sh stop       # stop the tunnel
#
# Environment:
#   DOMAIN=<your>.ngrok-free.dev   your claimed ngrok dev domain (see below)
#   PORT=3000                      local server port
#   MCP_PATH=/mcp                  MCP endpoint path
#   AUTO_START=1                   build + start the server if it is not already running
#   NGROK_BIN=<path>               path to the ngrok binary
#   NGROK_API=http://127.0.0.1:4040  ngrok local agent API
#
# Setup (one time):
#   1. Free account            -> https://dashboard.ngrok.com
#   2. authtoken               -> https://dashboard.ngrok.com/get-started/your-authtoken
#        ~/.local/bin/ngrok config add-authtoken <TOKEN>
#   3. claim your dev domain   -> https://dashboard.ngrok.com/domains
#        (looks like: xxxx-yyyy-zzzz.ngrok-free.dev)
#
# Notes:
#   * The ngrok dev domain is STABLE: it does not change between restarts. Only a
#     tunnel started WITHOUT --url gets a random *.ngrok-free.app URL each time.
#   * This exposes the server to the ENTIRE public internet. The server has NO
#     authentication and full shell/file access — anyone with the URL can run
#     arbitrary commands on this machine.

set -euo pipefail

PORT="${PORT:-3000}"
MCP_PATH="${MCP_PATH:-/mcp}"
DOMAIN="${DOMAIN:-subcarinate-juelz-heliographically.ngrok-free.dev}"
AUTO_START="${AUTO_START:-0}"
NGROK_API="${NGROK_API:-http://127.0.0.1:4040}"
MODE="${1:-${MODE:-start}}"
LOCAL_URL="http://127.0.0.1:${PORT}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGROK_LOG="/tmp/z-agent-ngrok.log"

log() { printf '%s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
curl_ok() { curl -fsS --max-time 5 "$1" >/dev/null 2>&1; }

# ── locate the ngrok binary ──────────────────────────────────────────────
if [ -z "${NGROK_BIN:-}" ]; then
  if command -v ngrok >/dev/null 2>&1; then
    NGROK_BIN="$(command -v ngrok)"
  elif [ -x "$HOME/.local/bin/ngrok" ]; then
    NGROK_BIN="$HOME/.local/bin/ngrok"
  else
    die "ngrok not found. Install it, or set NGROK_BIN=/path/to/ngrok."
  fi
fi

# ── read the current tunnel URL out of ngrok's local agent API ────────────
public_url() {
  curl -fsS --max-time 5 "${NGROK_API}/api/tunnels" 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const j = JSON.parse(s);
        const t = (j.tunnels || []).find(x => (x.public_url || "").startsWith("https"));
        if (t) process.stdout.write(t.public_url);
      } catch { /* ignore */ }
    });
  '
}

banner() {
  local url="$1"
  cat <<EOF

============================================================
 z-agent MCP server exposed via ngrok
------------------------------------------------------------
   domain    : $DOMAIN
   local     : ${LOCAL_URL}${MCP_PATH}
   external  : ${url}${MCP_PATH}
============================================================

 Point your MCP client at the external URL above, e.g.
   { "mcpServers": { "z-agent": { "url": "${url}${MCP_PATH}" } } }

 To stop exposing:  $0 stop
EOF
}

# ── stop ─────────────────────────────────────────────────────────────────
if [ "$MODE" = "stop" ]; then
  pkill -x ngrok 2>/dev/null || true
  log "Stopped the ngrok tunnel."
  exit 0
fi

# ── status ───────────────────────────────────────────────────────────────
if [ "$MODE" = "status" ]; then
  URL="$(public_url)"
  if [ -z "$URL" ]; then
    log "No ngrok tunnel is running (no response from ${NGROK_API})."
    exit 1
  fi
  banner "$URL"
  exit 0
fi

[ "$MODE" = "start" ] || die "Unknown mode '$MODE' (use: start | status | stop)"

command -v node >/dev/null 2>&1 || die "node is required (used to parse the ngrok API)."
[ -n "$DOMAIN" ] || die "Set DOMAIN=<your>.ngrok-free.dev (see https://dashboard.ngrok.com/domains)."

# ── make sure the local MCP server is up ─────────────────────────────────
if ! curl_ok "${LOCAL_URL}/health"; then
  if [ "$AUTO_START" = "1" ]; then
    log "Server not responding; building and starting it (AUTO_START=1)..."
    ( cd "$PROJECT_DIR" && npm install --silent && npm run build ) >/tmp/z-agent-build.log 2>&1 \
      || die "Build failed. See /tmp/z-agent-build.log"
    ( cd "$PROJECT_DIR" && setsid nohup npm start </dev/null >/tmp/z-agent.log 2>&1 & )
    for _ in $(seq 1 40); do
      curl_ok "${LOCAL_URL}/health" && break
      sleep 0.5
    done
  fi
fi

curl_ok "${LOCAL_URL}/health" \
  || die "No MCP server responding at ${LOCAL_URL}/health. Start it first (npm run build && npm start), or set AUTO_START=1."

# ── (re)start the tunnel on the stable domain ────────────────────────────
log "Starting ngrok tunnel -> ${LOCAL_URL} on https://${DOMAIN} ..."
pkill -x ngrok 2>/dev/null || true
sleep 1
: >"$NGROK_LOG"
setsid nohup "$NGROK_BIN" http "$PORT" --url "https://${DOMAIN}" --log stdout \
  </dev/null >>"$NGROK_LOG" 2>&1 &

URL=""
for _ in $(seq 1 30); do
  sleep 1
  URL="$(public_url)"
  [ -n "$URL" ] && break
done

if [ -z "$URL" ]; then
  cat "$NGROK_LOG" >&2
  die "ngrok did not come up. Is your authtoken set and '$DOMAIN' claimed on your account?"
fi

if ! curl_ok "${URL}/health"; then
  log "WARNING: tunnel is up but ${URL}/health did not respond yet."
fi

banner "$URL"
