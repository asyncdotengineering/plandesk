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

# Static gates: eslint (every package) + the web app's typecheck. The web app
# builds with vite/esbuild, which does NOT typecheck — `typecheck` (tsc --noEmit)
# is its only type gate, so it must run here or web type errors ship silently.
( cd "$ROOT" && pnpm exec turbo run lint typecheck )
echo "cmd:lint_typecheck OK"

# The docs skill page claims `connect` writes "the same content". Nothing
# enforced that, and it drifted for several releases — telling agents edges
# only join tasks after documents could already be linked many-to-one.
node "$ROOT/scripts/sync-skill-doc.mjs" --check
echo "cmd:skill_doc_in_sync OK"

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

# No token: validate binds the server to loopback, and a loopback bind is the
# local trust boundary — every request is the org owner. This previously called
# `plandesk token create`, a command that no longer exists; the step had been
# failing unnoticed behind the lint errors ahead of it.
pnpm --filter @plandesk/cli exec node scripts/mcp-list-tools.mjs "$BASE_URL"
echo "cmd:mcp_list_tools OK"

echo "validate.sh: all checks passed"
