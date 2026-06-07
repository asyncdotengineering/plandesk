#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLANDESK="$ROOT/packages/plandesk-cli/bin/plandesk"
DATA_DIR=""
PORT=""
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "${DATA_DIR:-}" ]] && [[ -d "$DATA_DIR" ]]; then
    rm -rf "$DATA_DIR"
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -x "$PLANDESK" ]]; then
  echo "validate.sh: plandesk CLI not found at $PLANDESK (run pnpm build first)" >&2
  exit 1
fi

DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/plandesk-validate.XXXXXX")"
PORT="$(node -e "const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});")"
BASE_URL="http://127.0.0.1:${PORT}"

"$PLANDESK" init --data-dir "$DATA_DIR" >/dev/null

"$PLANDESK" serve --port "$PORT" --data-dir "$DATA_DIR" >/dev/null 2>&1 &
SERVER_PID=$!

ready=0
for _ in $(seq 1 50); do
  if curl -sf "${BASE_URL}/api/v1/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done

if [[ "$ready" -ne 1 ]]; then
  echo "cmd:plandesk_serve FAILED: server did not become ready on ${BASE_URL}" >&2
  exit 1
fi

HEALTH_OK="$(curl -sf "${BASE_URL}/api/v1/health" | jq -er '.ok')"
if [[ "$HEALTH_OK" != "true" ]]; then
  echo "cmd:api_health FAILED: expected ok=true, got ${HEALTH_OK}" >&2
  exit 1
fi
echo "cmd:api_health OK"

if ! curl -sf "${BASE_URL}/api/v1/health" >/dev/null; then
  echo "cmd:plandesk_serve FAILED: server stopped responding" >&2
  exit 1
fi
echo "cmd:plandesk_serve OK (${BASE_URL})"

TOKEN="$("$PLANDESK" token create --name validate --data-dir "$DATA_DIR")"
pnpm --filter @plandesk/cli exec node scripts/mcp-list-tools.mjs "$BASE_URL" "$TOKEN"
echo "cmd:mcp_list_tools OK"

echo "validate.sh: all checks passed"
