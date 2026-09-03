#!/usr/bin/env bash
# Durable restart loop for Draft Room Next.js on port 43173.
# Intended to run inside tmux session `draft-room-dev` (or via Cloud Agent `start`).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-43173}"
HOST="${HOST:-0.0.0.0}"
BACKOFF_SEC="${BACKOFF_SEC:-2}"

cd "$ROOT"

echo "[keep-dev-server] starting in $ROOT (bind ${HOST}:${PORT})"

while true; do
  echo "[keep-dev-server] launching: npx next dev --port ${PORT} --hostname ${HOST}"
  npx next dev --port "$PORT" --hostname "$HOST"
  status=$?
  echo "[keep-dev-server] next exited with status ${status} — restarting in ${BACKOFF_SEC}s"
  sleep "$BACKOFF_SEC"
done
