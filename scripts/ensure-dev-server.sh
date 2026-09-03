#!/usr/bin/env bash
# Ensure Draft Room keep-alive is running in tmux session draft-room-dev.
# Used by Cloud Agent `.cursor/environment.json` start and for manual boots.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${SESSION:-draft-room-dev}"
CONF="${TMUX_CONF:-/exec-daemon/tmux.portal.conf}"
KEEPALIVE="$ROOT/scripts/keep-dev-server.sh"

if [ -x /exec-daemon/tmux ]; then
  TMUX_BIN=/exec-daemon/tmux
elif command -v tmux >/dev/null 2>&1; then
  TMUX_BIN="$(command -v tmux)"
else
  TMUX_BIN=""
fi

if [ -n "$TMUX_BIN" ] && [ -f "$CONF" ]; then
  if ! "$TMUX_BIN" -f "$CONF" has-session -t "=$SESSION" 2>/dev/null; then
    echo "[ensure-dev-server] creating tmux session $SESSION"
    "$TMUX_BIN" -f "$CONF" new-session -d -s "$SESSION" -c "$ROOT" -- bash "$KEEPALIVE"
  else
    # Session exists but may be idle at a shell — kick the keep-alive if next is down.
    if ! curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:${PORT:-43173}/"; then
      echo "[ensure-dev-server] session $SESSION exists but server down — starting keep-alive"
      "$TMUX_BIN" -f "$CONF" send-keys -t "$SESSION:0.0" C-c
      "$TMUX_BIN" -f "$CONF" send-keys -t "$SESSION:0.0" "bash '$KEEPALIVE'" C-m
    else
      echo "[ensure-dev-server] session $SESSION already healthy"
    fi
  fi
  exit 0
fi

echo "[ensure-dev-server] tmux unavailable — running keep-alive in foreground"
exec bash "$KEEPALIVE"
