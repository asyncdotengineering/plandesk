# Sprint 5 Review (Phase B) — Distribution + integration + dogfood

**Reviewer:** Manager (Opus 4.8), 2026-06-08
**Scope:** `693b5a6`, `6c50fb3`, `d86d8f1`, `d517101`, `435cac3` on `main`
**Sprint goal:** `plandesk connect` wires a repo (commit-safe); `docker compose up` serves on :3847; the Factory adapter lists projects over MCP; the dogfood fixture imports clean.

## Verdict: **SOLID — shipping.** All four verified live. Plan Desk is now distributable and integratable.

## Layer 1 — What works (grounded, live-verified)

- **`plandesk connect` (RFC §4.7).** In a throwaway repo: `.plandesk/{config.json,skill.md}` committed, `token` gitignored, `.mcp.json` with `${PLANDESK_MCP_TOKEN}`, idempotent CLAUDE.md sentinel block (original preserved), `--print` dry-run, clean `disconnect`. **No raw token in any committed-eligible file.** This is the answer to the program's original gray area — now real, secure tooling.
- **Docker self-host runs in a real container.** Non-root; loopback default / password-gated 0.0.0.0 (REQ-6, refuses 0.0.0.0 without password); UI + API + MCP on :3847; **project persists across `docker restart`** via the named volume.
- **Factory adapter (`@plandesk/mcp-client`).** Connects over Streamable HTTP + Bearer; `listProjects()` returns the seeded project; MCP-only coupling (REQ-12) — no internals, no canvas-state dup.
- **Dogfood.** `examples/checkout-revamp.json` (8 tasks, 6 labeled edges, 3 linked docs, all statuses) imports losslessly; inspectable over REST + MCP.

## Layer 2 — Blockers / majors

**None blocking.** One substantial manager fix (Docker), found only by actually building + running:

- **`[S5-02-fix]` — 3 real Docker defects** the worker's static Dockerfile hid: (1) build COPY omitted `tsconfig.base.json` (tsc failed in-container); (2) `pnpm prune --prod` **deletes the per-package workspace symlinks** → runtime `ERR_MODULE_NOT_FOUND: @plandesk/db` (proven via build-stage inspection); (3) runtime cherry-picked `dist/` only. Removed prune, copy full packages. Verified end-to-end in a container. **This is exactly why UI/infra stories get real execution, not just test-green.**

Notes (not debt, tracked):
- Docker image **551MB** (keeps build deps to preserve workspace resolution). v1.x: `pnpm deploy --prod` to slim it (must handle the `static.ts` web-dist path). Core platform rules honored: single slim non-root container, SQLite on a volume, no managed DB.
- `createPlandeskClient` is async — documented; consumers `await` it.

## Layer 3 — Verdict

**SOLID — shipping.** The product is feature-complete AND distributable: a developer can `docker compose up` to self-host, `plandesk connect` to wire an agent repo (securely), and consume it from Factory Desk over MCP. Advance to **Sprint 6 (Polish + 1.0)** — wire the §9 validation suite, measure §1 metrics, write docs, tag `v1.0.0`.

## Risk-register check (WBS §5)

- *Token leak in committed files* — closed: no `plandesk_mcp_` in committed-eligible set; env-var `.mcp.json`; gitignored token.
- *Idempotency dups* — closed: sentinel-block replace; tested + live.
- *Docker bloat / multi-container / managed DB* — single slim non-root container, SQLite volume (size noted for v1.x).
- *Adapter duplicates canvas* — closed: read-only over MCP.

## RFC housekeeping to fold (carried, do in S6 docs pass)

- RFC §8 C17 → reference `plandesk connect` + `.plandesk/` + `connect.ts`.
- RFC §7.4 skill stub → pointer to §4.7.5.
- RFC §4.4 → note additive `projects.canvas_layout` column.
