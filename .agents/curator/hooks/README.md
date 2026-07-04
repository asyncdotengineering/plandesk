# Board-as-memory hooks

These scripts re-anchor a Claude Code agent to this repo's bound Plan Desk
board across the moments it's most likely to lose the thread — a fresh
session, a resumed session, and a post-compaction session — and checkpoint
progress before it's lost.

- `session-start.sh` — on `SessionStart` (startup/resume/compact), runs
  `plandesk context --json` and, if the bound project has a task in
  progress (or a next actionable task when idle), injects a summary of it —
  current task, its linked doc, and the last recorded agent-run progress —
  as additional context for the session.
- `checkpoint.sh` — on `Stop` and `PreCompact`, runs
  `plandesk progress-checkpoint` to post a best-effort checkpoint message to
  the project's currently running agent run.

Both scripts no-op silently (exit 0) when the repo isn't connected
(`.plandesk/config.json`/`.plandesk/token` missing) or there's nothing to
report — a broken or idle binding must never block a session start, stop, or
compaction. They assume `plandesk` is on `PATH` (install with
`npm i -g @plandesk/cli` or `plandesk connect` from an existing install).

`settings.snippet.json` is the `.claude/settings.json` `hooks` block a
project adds to wire these in — merge it into the project's existing
`hooks` key (don't overwrite other hooks already configured there). This is
not yet wired into `plandesk factory init`; until that lands, a human (or a
future installer) merges the snippet by hand.
