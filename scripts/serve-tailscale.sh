#!/usr/bin/env bash
#
# serve-tailscale.sh — expose the local z-agent MCP server through Tailscale.
#
# Usage:
#   ./scripts/serve-tailscale.sh            # tailnet-only  (tailscale serve)   [default]
#   ./scripts/serve-tailscale.sh funnel     # public internet (tailscale funnel)
#   ./scripts/serve-tailscale.sh reset      # remove the Tailscale proxy config
#
# Environment:
#   PORT=3000            local server port
#   MCP_PATH=/mcp        MCP endpoint path
#   AUTO_START=1         build + start the server if it is not already running
#   TS_OPERATOR=0        do not auto-run `sudo tailscale set --operator=$USER`
#
# Notes:
#   * `serve`  exposes the endpoint only to devices on your tailnet (private).
#   * `funnel` exposes it to the ENTIRE public internet. This server has NO
#     authentication and full shell/file access — only use funnel if you really
#     know what you are doing.
#   * Writing the serve config requires root. This script will automatically set
#     you as the Tailscale operator once (via passwordless sudo) so that later
#     runs need no privileges. Requires HTTPS certificates enabled for your
#     tailnet (admin console -> DNS -> HTTPS Certificates).

set -euo pipefail

PORT="${PORT:-3000}"
MCP_PATH="${MCP_PATH:-/mcp}"
MODE="${1:-${MODE:-serve}}"
AUTO_START="${AUTO_START:-0}"
TS_OPERATOR="${TS_OPERATOR:-1}"
LOCAL_URL="http://127.0.0.1:${PORT}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS_LOG="/tmp/z-agent-tailscale.log"

log() { printf '%s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
curl_ok() { curl -fsS --max-time 5 "$1" >/dev/null 2>&1; }

command -v tailscale >/dev/null 2>&1 || die "tailscale CLI not found. Install Tailscale first."

# ── reset ────────────────────────────────────────────────────────────────
if [ "$MODE" = "reset" ]; then
  if ! tailscale serve reset 2>"$TS_LOG"; then
    sudo tailscale serve reset 2>>"$TS_LOG" || { cat "$TS_LOG" >&2; die "reset failed"; }
  fi
  log "Removed the Tailscale serve/funnel configuration."
  exit 0
fi

case "$MODE" in
  serve|funnel) ;;
  *) die "Unknown mode '$MODE' (use: serve | funnel | reset)";;
esac

# ── sanity checks ────────────────────────────────────────────────────────
tailscale status >/dev/null 2>&1 || die "Tailscale is not running / not logged in. Run 'tailscale up' first."

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

# ── read data out of tailscale's JSON ────────────────────────────────────
ts_served_host() {
  tailscale "$MODE" status --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const j = JSON.parse(s);
        const key = Object.keys(j.Web || {})[0];
        if (key) process.stdout.write(key.replace(/:\d+$/, ""));
      } catch { /* ignore */ }
    });
  '
}

ts_dnsname() {
  tailscale status --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const j = JSON.parse(s);
        const n = (j.Self && j.Self.DNSName) || "";
        if (n) process.stdout.write(n.replace(/\.$/, ""));
      } catch { /* ignore */ }
    });
  '
}

# ── configure the proxy (with automatic operator bootstrap) ──────────────
apply_serve() {
  : >"$TS_LOG"
  if tailscale "$MODE" --bg --https=443 "$LOCAL_URL" >>"$TS_LOG" 2>&1; then
    return 0
  fi

  if grep -qi "denied" "$TS_LOG"; then
    log "Tailscale denied writing the serve config (needs root / operator)."
    if [ "$TS_OPERATOR" = "1" ] && command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
      log "Setting '$USER' as the Tailscale operator (one-time)..."
      sudo tailscale set --operator="$USER" >>"$TS_LOG" 2>&1 || true
      if tailscale "$MODE" --bg --https=443 "$LOCAL_URL" >>"$TS_LOG" 2>&1; then
        return 0
      fi
      log "Retrying with sudo..."
      sudo tailscale "$MODE" --bg --https=443 "$LOCAL_URL" >>"$TS_LOG" 2>&1 && return 0
    else
      log "Run this once, then re-run the script:"
      log "    sudo tailscale set --operator=$USER"
    fi
  fi

  # Older Tailscale versions / no URL target support: fall back to port form.
  tailscale "$MODE" --bg "$PORT" >>"$TS_LOG" 2>&1 && return 0
  sudo tailscale "$MODE" --bg "$PORT" >>"$TS_LOG" 2>&1 && return 0

  return 1
}

log "Configuring 'tailscale $MODE' -> ${LOCAL_URL} ..."
if ! apply_serve; then
  cat "$TS_LOG" >&2
  die "tailscale $MODE failed. Is HTTPS enabled for your tailnet? (admin console -> DNS -> HTTPS Certificates)"
fi

# ── resolve and print the external URL ───────────────────────────────────
HOSTNAME_TS="$(ts_served_host)"
[ -z "$HOSTNAME_TS" ] && HOSTNAME_TS="$(ts_dnsname)"

if [ -z "$HOSTNAME_TS" ]; then
  log "Could not determine the Tailscale hostname automatically."
  log "Check the configuration with: tailscale $MODE status"
  exit 0
fi

EXTERNAL_URL="https://${HOSTNAME_TS}${MCP_PATH}"
SCOPE="tailnet only"
[ "$MODE" = "funnel" ] && SCOPE="PUBLIC INTERNET (no auth!)"

cat <<EOF

============================================================
 z-agent MCP server exposed via Tailscale
------------------------------------------------------------
   mode      : $MODE ($SCOPE)
   local     : ${LOCAL_URL}${MCP_PATH}
   external  : ${EXTERNAL_URL}
============================================================

 Point your MCP client at the external URL above, e.g.
   { "mcpServers": { "z-agent": { "url": "${EXTERNAL_URL}" } } }

 To stop exposing:  $0 reset
EOF