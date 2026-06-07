# Proceed Evidence — S5-01 plandesk connect + .plandesk + skill (C17 + §4.7)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `693b5a6` `[S5-01] plandesk connect + .plandesk + skill` (cursor)
**Date:** 2026-06-08

## Acceptance criteria (PLAN §S5-01 / RFC §4.7)

| # | Criterion | Result (live, throwaway repo) |
|---|-----------|-------------------------------|
| 1 | `connect --print` shows artifacts, writes nothing | ✅ printed config.json + skill.md; repo unchanged after |
| 2 | Real run writes `.plandesk/{config,skill,token}` + `.mcp.json` + CLAUDE.md + .gitignore | ✅ all present |
| 3 | **No secret in committed-eligible files** | ✅ grep `plandesk_mcp_` over config.json/.mcp.json/CLAUDE.md/.codex → none |
| 4 | Raw token only in gitignored `.plandesk/token`; `.mcp.json` env-var | ✅ token in `.plandesk/token` (gitignored); `.mcp.json` → `${PLANDESK_MCP_TOKEN}` |
| 5 | CLAUDE.md sentinel added, original preserved | ✅ block added; "Project instructions" kept |
| 6 | **Idempotent re-run** | ✅ `plandesk:start` count=1; `.gitignore` token-line=1 |
| 7 | `disconnect` removes cleanly | ✅ `.plandesk` gone; sentinel removed; original CLAUDE.md kept |

## Independent verification (manager-run, LIVE)

Ran against a real served instance + a throwaway git repo (with a pre-existing CLAUDE.md + .gitignore):
- `--print` → dry run listing CREATE actions (config.json `plandesk-connect-v1`, skill.md), zero file changes.
- Real `connect` → `.plandesk/config.json` (no secret), `.plandesk/skill.md` (RFC §4.7.5), `.plandesk/token` (gitignored), `.mcp.json` (`${PLANDESK_MCP_TOKEN}`), `.gitignore` += token, CLAUDE.md sentinel block.
- **Security:** no `plandesk_mcp_` in any committed-eligible file; raw only in the gitignored token file.
- **Idempotency:** re-run → no duplicate sentinel/gitignore entries.
- **disconnect:** clean removal, original CLAUDE.md content intact.
- `resolveAgents` detect logic is correct: CLAUDE.md-only repo wires Claude (no spurious `.codex/`); `--agent both`/`codex` or an existing `.codex/` writes the Codex command file.
- Gates: build 6/6, cli 40 tests, lint+Prettier clean. No strays/leaks.

## Significance

This is the RFC §4.7 work added at the program's start — the answer to the original gray area ("how does a repo's agent connect to the MCP; should there be `.plandesk/`; how to update CLAUDE.md without overwriting"). It is now real, secure (no committed secrets), idempotent tooling.

→ Proceed to **S5-02 (Docker self-host)**.
