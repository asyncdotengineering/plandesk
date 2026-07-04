# Session handoff — Plan Desk / AI Software Factory

Written 2026-07-03. Previous session: designed the AI Software Factory phase-beta, shipped it into Plan Desk, and cut two releases. A fresh agent in this repo can continue from here.

## Where things stand

**Released and live (all verified):**

- **npm**: `@plandesk/cli@0.9.1`, `@plandesk/mcp@0.8.0`, `@plandesk/api@0.8.0`, `@plandesk/db@0.6.0`, `@plandesk/sync-server@0.5.0`
- **git**: `main` @ `e086508`, tags `v0.9.0` + `v0.9.1` pushed. Feature branches `feature/factory-scaffold`, `feature/doc-folders`, `feature/task-tags` are merged; worktrees removed.
- **docs**: plandesk.asyncdot.com redeployed (Cloudflare Pages project `plandesk-docs`, direct upload via `wrangler pages deploy apps/docs/dist --project-name plandesk-docs` — **no git auto-deploy; manual step after every docs change**).
- **GitHub issues #4–#8**: all closed with resolution comments.

What shipped and why is in `CHANGELOG.md` (top two entries) — don't re-derive it from git.

**This repo is self-hosting the factory:**

- Bound Plan Desk project: `ai-software-factory` — server `plandesk serve` on **port 3400** (loopback), UI at `$(plandesk url)`. Board holds the phase-beta plan **B0–B5** (B0/B1 `todo`, B2–B5 `scope`), the shipped F1 task, a release-gate decision card (`scope`), a Design doc on B1, and research/release notes.
- Factory policy: `.agents/factory/` (workflow.md, factory.md incl. the IC-first supervisor posture, protocol.md, workers/, lanes.md, verifiers/) — always-on via the `<!-- plandesk-factory -->` block in this repo's `CLAUDE.md`.
- Secrets: `.plandesk/token` and `.plandesk/sync-token` are gitignored — never read them into output.

## Conventions the next agent must honor

1. **IC-first**: follow `.agents/factory/workflow.md` + `factory.md` — orchestrate, dispatch to workers per `protocol.md`; don't implement inline except trivial edits/briefs/integration.
2. **Never write agent config into global dirs** (`~/.claude` etc.) — the CLI guards this; don't work around it. Global `~/.claude/CLAUDE.md` is the user's curated contract — propose project-local placement for any new policy.
3. **Board stays true**: statuses flip atomically with work events; `scope` → `todo` is human-only (convention; see the open decision card).
4. Routing/policy changes go into `workers/*.md` / `lanes.md` (data), not prose instructions.

## Open threads (rough priority)

1. **B0/B1 on the board are released (`todo`)** — B0: consolidate `~/.claude` + `~/.agents` agent OS with xref lint + executor cull; B1: rewire the loop-engineer skill onto Plan Desk as work-item spine. `get_next_task` will hand you B0.
2. **Release-gate decision card** (`scope`, awaiting human): hard-enforce human-only `scope→todo` vs keep convention (options in the card).
3. **Docs auto-deploy**: add a GitHub Action (build `apps/docs` → `wrangler pages deploy` on `apps/docs/**` change to main). The site silently lagged a full release behind.
4. **Skills packaging**: stand up `asyncdotengineering/skills` (SKILL.md dirs, installed via `npx skills add` — decided: NO plandesk installer); plandesk's remaining delta = `requires:` frontmatter + dependency probing in `plandesk doctor` (unbuilt).
5. **Feature ideas from issue #4** (unticketed): one-command `plandesk share`, `share revoke`/`unpublish`, doctor connect-ambiguity flags, `sync --daemon`.
6. **Pre-existing lint debt**: `pnpm lint` fails in 5 files untouched by this session (`packages/plandesk-cli/src/{serve.ts,init.ts,cli.test.ts,connect-artifacts.test.ts,watch.test.ts}`) — small cleanup commit.
7. **Later horizon**: B2–B5 (verifiers/red-gate, lanes, metrics ledger + skill evals, weekly meta-loop); Mastra as hosted execution shell reading the same `.agents/` files.

## Suggested skills

- **plandesk** (auto-loads via `.plandesk/skill.md`) — the board loop: `get_next_task` → linked doc → work → `update_task`; wrap multi-step runs in `start_agent_run`/`complete_agent_run`; pull `list_comments` at session start.
- **/factory** (command) — reloads workflow + contract explicitly.
- **/delegate** and **/delegate-review** — IC dispatch and adversarial review, per the posture.
- **/ship-it** — the engineering bar for anything released.
- **/verify** — drive changed flows end-to-end before claiming done (this session's releases were all live-smoked; keep that standard).
- **/code-review** — before merging any feature branch.

## Context the repo can't tell you

- The broader program (three planes: plandesk = control, Claude Code → Mastra = execution, `.agents/` = knowledge) and its research provenance live in the user's memory (`project_ai_software_factory`) and the board's Design doc + research note — read the board doc first.
- `npx skills` (skills.sh) was adopted deliberately over building an installer; don't re-propose one.
- Both feature slices (#7 folders, #8 tags) were built by parallel worktree agents and integrated with a regenerated migration (`0007_busy_naoko`); migration order matters — folders is `0006`.
