#!/usr/bin/env bash
#
# release-e2e — exercise the PACKAGED artifact, not the working tree.
#
# Every in-repo gate (build, five test suites, `pnpm pack`) passed while
# `plandesk factory init` was broken for every consumer: npm rewrites a
# packaged `.gitignore` to `.npmignore` at INSTALL time, so a file that is
# present in the tarball is gone once installed. Only a real `npm install`
# of the tarball reproduces that class of bug. This script is that gate.
#
#   pnpm release:e2e                 # pack local packages and test them
#   PLANDESK_E2E_FROM_NPM=1 \
#     pnpm release:e2e               # test what is actually published
#
# Runs entirely under a temp dir on a non-default port. It never touches
# ~/.plandesk or port 7526.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${PLANDESK_E2E_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/plandesk-e2e.XXXXXX")}"
PORT="${PLANDESK_E2E_PORT:-7599}"
FROM_NPM="${PLANDESK_E2E_FROM_NPM:-0}"

pass=0; fail=0
chk() { if eval "$2"; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
section() { echo; echo "=== $1 ==="; }

cleanup() {
  [ -f "$WORK/serve.pid" ] && kill "$(cat "$WORK/serve.pid")" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$WORK/toolchain"
echo "work dir: $WORK"

# ---------------------------------------------------------------- 1. install
section "install the artifact"
cd "$WORK/toolchain"
echo '{"name":"plandesk-e2e","private":true}' > package.json

if [ "$FROM_NPM" = "1" ]; then
  echo "source: npm registry"
  npm install --no-audit --no-fund @plandesk/cli@latest >/dev/null 2>&1
else
  echo "source: locally packed tarballs"
  (cd "$REPO_ROOT" && pnpm build >/dev/null 2>&1)
  mkdir -p "$WORK/tarballs"
  for p in db api mcp cli; do
    (cd "$REPO_ROOT/packages/plandesk-$p" && pnpm pack --pack-destination "$WORK/tarballs" >/dev/null 2>&1)
  done
  npm install --no-audit --no-fund "$WORK"/tarballs/*.tgz >/dev/null 2>&1
fi

PD="$WORK/toolchain/node_modules/.bin/plandesk"
chk "CLI is installed and runnable" "test -x '$PD'"
echo "  version: $("$PD" --version)"

# The exact failure mode that shipped broken. npm rewrites `.gitignore`, so
# assert on what survives INSTALL, not on what `pnpm pack` produced.
section "packaged templates survive npm install"
TPL="$WORK/toolchain/node_modules/@plandesk/cli/dist/templates"
chk "templates directory installed" "test -d '$TPL'"
chk "no dotfiles left for npm to rewrite" \
    "[ \"\$(find '$TPL' -name '.*' -type f | wc -l | tr -d ' ')\" = 0 ]"
chk "factory policy present" "test -f '$TPL/factory/factory.md'"
chk "curator skills present" "test -d '$TPL/skills/curator-triage'"

# ------------------------------------------------------------------ 2. board
section "isolated board boots"
export PLANDESK_DATA_DIR="$WORK/board"
mkdir -p "$PLANDESK_DATA_DIR"
"$PD" init --data-dir "$PLANDESK_DATA_DIR" >/dev/null 2>&1
"$PD" serve --data-dir "$PLANDESK_DATA_DIR" --port "$PORT" --strict-port > "$WORK/serve.log" 2>&1 &
echo $! > "$WORK/serve.pid"
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 0.5
done
chk "server answers /health" "curl -fsS 'http://127.0.0.1:$PORT/api/v1/health' >/dev/null"

# A loopback bind is the local trust boundary: both spellings must behave the
# same, which is the bug users hit on `localhost` while `127.0.0.1` worked.
chk "loopback owner access on 127.0.0.1" \
    "curl -fsS 'http://127.0.0.1:$PORT/api/v1/projects' >/dev/null"
chk "loopback owner access on localhost" \
    "curl -fsS 'http://localhost:$PORT/api/v1/projects' >/dev/null"

# ------------------------------------------------------------------- 3. MCP
section "MCP surface and the link shape"
# Run the probe from inside the work dir so it resolves the MCP SDK out of the
# INSTALLED toolchain, not the repo's own node_modules.
ln -sfn "$WORK/toolchain/node_modules" "$WORK/node_modules"
cp "$REPO_ROOT/scripts/release-e2e-mcp.mjs" "$WORK/release-e2e-mcp.mjs"
if MCP_URL="http://127.0.0.1:$PORT/mcp" node "$WORK/release-e2e-mcp.mjs" "$WORK"; then
  echo "  PASS  MCP suite"; pass=$((pass+1))
else
  echo "  FAIL  MCP suite"; fail=$((fail+1))
fi

# --------------------------------------------------------------- 4. scaffold
section "connect + factory init in a fresh repo"
REPO="$WORK/newproj"
mkdir -p "$REPO/.agents/foreign" "$REPO/.claude"
(cd "$REPO" && git init -q .)

# `.agents/` is a shared namespace — foreign content must survive untouched.
echo 'foreign tool config' > "$REPO/.agents/foreign/config.md"
printf '{\n  "hooks": {\n    "SessionStart": [\n      { "matcher": "*", "hooks": [ { "type": "command", "command": "echo USER-HOOK" } ] }\n    ]\n  }\n}\n' > "$REPO/.claude/settings.json"

PROJECT_ID=$(cat "$WORK/project-id")
"$PD" connect --repo "$REPO" --project "$PROJECT_ID" --url "http://127.0.0.1:$PORT" >/dev/null 2>&1
"$PD" factory init --repo "$REPO" >/dev/null 2>&1

chk "factory init succeeded (the npm-install crash)" "test -f '$REPO/.agents/factory/factory.md'"
chk ".mcp.json written" "test -f '$REPO/.mcp.json'"
chk "hooks are executable" "test -x '$REPO/.agents/factory/hooks/session-start.sh'"
chk "foreign .agents content survived" "grep -q 'foreign tool config' '$REPO/.agents/foreign/config.md'"
chk "user's untagged hook survived" "grep -q 'USER-HOOK' '$REPO/.claude/settings.json'"

# Reclaim, not append: reruns converge instead of stacking duplicate hooks.
echo 'LOCAL EDIT' >> "$REPO/.agents/factory/factory.md"
"$PD" factory init --repo "$REPO" >/dev/null 2>&1
"$PD" factory init --repo "$REPO" >/dev/null 2>&1
chk "hooks converge across reruns (no duplicates)" \
    "[ \"\$(node -e \"const j=require('$REPO/.claude/settings.json');console.log(Object.values(j.hooks).flat().filter(e=>e._plandesk).length)\")\" = 3 ]"
chk "user hook still present exactly once" \
    "[ \"\$(grep -c 'USER-HOOK' '$REPO/.claude/settings.json')\" = 1 ]"
chk "author edits to policy are create-once" "grep -q 'LOCAL EDIT' '$REPO/.agents/factory/factory.md'"
chk "plandesk context resolves" "'$PD' context --json --repo '$REPO' >/dev/null"

# ---------------------------------------------------------- 5. export/import
section "export → import preserves document links"
OUT="$WORK/export.json"
"$PD" export --project "$PROJECT_ID" --out "$OUT" --data-dir "$PLANDESK_DATA_DIR" >/dev/null 2>&1
chk "export written" "test -s '$OUT'"
chk "export carries typed edge endpoints" "grep -q 'from_type' '$OUT'"
chk "export carries no legacy linked_task_id" "! grep -q 'linked_task_id' '$OUT'"

BOARD2="$WORK/board2"; mkdir -p "$BOARD2"
"$PD" init --data-dir "$BOARD2" >/dev/null 2>&1
"$PD" import --in "$OUT" --data-dir "$BOARD2" >/dev/null 2>&1
chk "import into an empty board succeeded" "test -s '$BOARD2/workspace.db'"

# --------------------------------------------------------------------- done
echo
echo "================================================"
echo "  release-e2e: $pass passed, $fail failed"
echo "  work dir: $WORK"
echo "================================================"
[ "$fail" -eq 0 ]
