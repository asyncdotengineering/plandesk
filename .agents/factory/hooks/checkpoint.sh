#!/usr/bin/env bash
# Stop / PreCompact hook — posts a best-effort progress checkpoint to the
# bound Plan Desk project's currently running agent run, so the last-known
# state survives a stop or compaction even if nothing was recorded manually.
#
# Same behavior for both events: no-op when idle (no binding, no running
# agent run). Always exits 0 — a broken checkpoint must never block Stop or
# compaction.
set +e

plandesk progress-checkpoint >/dev/null 2>&1

exit 0
