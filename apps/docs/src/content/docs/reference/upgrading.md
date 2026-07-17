---
title: Upgrading
description: Upgrade the Plan Desk CLI, server, and connected repos to the latest version — including the breaking 0.20.0 → better-auth migration.
---

Plan Desk ships as one npm package: `@plandesk/cli` contains the CLI, the server (`plandesk serve`), the MCP tools, and the web UI. Your data lives in `~/.plandesk` by default.

There are two kinds of upgrade on this page:

- **[Routine upgrade](#routine-upgrade)** — same schema, most releases: update the package, restart the server, migrations run automatically. Your data is untouched.
- **[The 0.20.0 → better-auth upgrade](#the-020x--better-auth-upgrade-breaking)** — a one-time **breaking** migration for anyone on 0.20.0 or earlier. The database schema was reset (no in-place migration) and the board moved to a machine-global default. Read that section before you upgrade past 0.20.0.

If you don't know which one applies: run `plandesk --version`. `0.20.x` or earlier → you need the breaking upgrade below. Anything newer → routine upgrade.

## Routine upgrade

Same schema, no breaking changes — this is every upgrade except the one below.

### 1. Update the package

```bash
npm i -g @plandesk/cli@latest
plandesk version   # confirm (also: plandesk --version)
```

### 2. Restart the server

Stop the running `plandesk serve` and start it again. The new server runs database migrations on startup and serves the updated web UI and MCP tools.

```bash
plandesk serve
```

### 3. Re-connect each repo

`plandesk connect` **is the upgrade command** for a repo: it is idempotent, reads the existing binding from `.plandesk/config.json`, reuses your token, and regenerates every artifact to the current version — `.mcp.json`, `.plandesk/skill.md`, the skill symlinks, the agent command files, and the `CLAUDE.md`/`AGENTS.md` sentinel block.

```bash
cd /path/to/your/repo
plandesk connect
```

Then start a **new** agent session so MCP tools and the skill reload.

### Sync the factory policy

`connect` and `factory init` regenerate the *generated* files (the sentinel block, adapters, `skill.md`), but the **authored** factory policy — `.agents/factory/{factory,workflow,protocol,lanes,autonomous-stand}.md` and `.agents/curator/*.md` — is created once and never overwritten, so your edits survive. That also means shipped improvements to those files don't reach an existing repo automatically. `plandesk factory sync` closes that gap without clobbering your edits:

```bash
plandesk factory sync            # dry-run: show what's stale vs. the shipped version
plandesk factory sync --write    # apply creates + safe updates; keep files you customized
plandesk factory sync --force    # also overwrite customized files with the shipped version
```

It classifies each file as **up to date**, **create** (missing), **safe update** (unmodified since it was scaffolded → updated in place), or **customized** (you edited it → kept, and reported so you can merge by hand or `--force`). Review with `git diff .agents/` before committing.

### 4. Verify

```bash
plandesk doctor --repo .
```

Checks the workspace DB, the binding, the token, and that the MCP server lists its tools.

## The 0.20.x → better-auth upgrade (breaking)

:::danger[Version boundary — read before you upgrade past 0.20.0]
If you're running **0.20.0 or earlier**, the next upgrade is **not** routine. The database schema baseline was replaced (no in-place migration) and the workspace moved from a per-repo `.plandesk/workspace.db` default to a **machine-global board** at `~/.plandesk/workspace.db`. `npm i -g @plandesk/cli@latest` followed by `plandesk serve` will **not** carry your old data forward automatically — you must run `plandesk legacy-upgrade` to bring it into the new board. Nothing is deleted: your old `workspace.db` is backed up in place before anything is imported.
:::

### What changed and why

Pre–better-auth installs used a hand-rolled token table (`mcp_tokens`), a GitHub device-code CLI login, hand-rolled browser sessions, and a separate `orgs`/`org_members` schema. Auth is now **100% better-auth** — sessions, API keys, organizations, membership, and roles all come from better-auth's own tables, created by its runtime migrator. Those two schemas can't coexist, so the Drizzle migration baseline was reset rather than dual-stacked: there is no migration path from an old `workspace.db` straight into `plandesk serve` on the new version. See the [CHANGELOG `Unreleased` → Breaking](https://github.com/asyncdotengineering/plandesk/blob/main/CHANGELOG.md) for the full breaking-change list.

At the same time, the workspace default moved to one **global board per machine** (`~/.plandesk/workspace.db`), shared by every connected repo, rather than a `.plandesk/workspace.db` per repo (`plandesk init --local-db` opts back into a repo-local one).

### Lift your old data in — one command

`plandesk legacy-upgrade` **creates the new global board itself** if it doesn't exist yet, then imports your old data — so the whole upgrade is a single command:

```bash
npm i -g @plandesk/cli@latest
plandesk legacy-upgrade [--from <path-to-old-workspace.db>]
```

(Prefer to create the board explicitly? Run `plandesk init` first — `legacy-upgrade` reuses it. Either way, your old database is never touched — only read and backed up.)

`--from` is optional: if omitted, it looks for an old-schema `workspace.db` at `~/.plandesk/workspace.db` first, then `./.plandesk/workspace.db`. Pass `--from` explicitly if your old board lived somewhere else.

What it actually does, exactly:

- Detects whether the source file is still the **old schema** (no `organization` table, no `org_id` column on `projects`). If it's already the new schema, it's a no-op — safe to run more than once.
- Reads every project from the old board **schema-lessly** (tolerates missing tables/columns from older versions) and imports each one's **projects, tasks, dependency edges, documents, notes, comments, and agent runs** into the new global board, all under the default organization.
- **Backs up the old file first** — a `<old-path>.pre-legacy-upgrade` copy is written before anything is imported, and it's never overwritten on a re-run.
- **Skips projects already imported** — matched by source project id or name — so running it again after importing more data, or after a partial run, never duplicates projects.
- Prints a one-line summary: projects/tasks/documents imported, how many were skipped as already-present, and where the backup landed.

```
Imported 4 projects, 37 tasks, 12 documents into the global board (org <id>). Skipped: 1 already present. Old board backed up to ~/.plandesk/workspace.db.pre-legacy-upgrade. Regenerate a CLI token via the dashboard for hosted use.
```

### What does *not* carry over

`legacy-upgrade` moves planning data only. It does **not** migrate:

- **Old MCP tokens** (`mcp_tokens`) — the table and the `/api/v1/mcp-tokens` endpoint are gone. Local loopback needs no token at all; for hosted use, generate a fresh CLI token from the dashboard.
- **Old share links / sync state** — these depended on the removed `orgs`/`org_members` schema and hosted session model and cannot be reconstructed. Re-create shares with `plandesk share create` once the project is on the new board.
- Anything auth- or hosting-related in general — this is entirely a re-provisioning step under the new better-auth model, described next.

### Step 3 — Re-provision auth (only if you use hosted)

Purely local use needs nothing further — `plandesk serve` on the new global board is zero-auth on loopback, same as before. If you connect this machine to a hosted organization:

1. Sign in on the dashboard (GitHub) and open **Settings → MCP** → **Generate CLI token**.
2. `plandesk login` (or `plandesk login --server <url>`) and paste the token.
3. From each previously-connected repo:

```bash
cd /path/to/each/bound/repo
plandesk connect --to <org> [--project "<name>"]
```

This mints a fresh **project-scoped agent key** into each repo's `.plandesk/token` — old tokens are gone and cannot be reused. Repeat `connect --to` for every previously-connected repo. Full grammar: [CLI Reference — hosted login and connect](/reference/cli/#hosted-login-and-connect-two-actor).

### Verify

```bash
plandesk doctor --repo .
```

Confirm the imported projects appear in the UI (`plandesk serve`, open the printed URL) with their tasks, documents, and edges intact, and that `.pre-legacy-upgrade` backup file exists next to your old database before you delete anything.

## Version notes

### Unreleased — better-auth native rewrite

**Breaking.** See [The 0.20.x → better-auth upgrade](#the-020x--better-auth-upgrade-breaking) above for the full migration path. Summary: auth is now 100% better-auth (GitHub social web sign-in, paste-a-token CLI, project-scoped agent keys); `mcp_tokens`, GitHub device-code CLI login, hand-rolled sessions, and the old `orgs`/`org_members` schema are removed; the Drizzle migration baseline was reset (no in-place migration); the workspace default moved to one global board per machine. Use `plandesk legacy-upgrade` to lift a 0.20.x-era board into the new one.

### 0.20.0

Share links in the UI (task/document **Share** action, 24h/7d/never TTL); `plandesk factory sync` to update scaffolded factory/curator policy without clobbering edits.

### 0.11.x

Latest: `@plandesk/cli@0.11.0` (depends on `@plandesk/api@0.10.0`, `@plandesk/db@0.8.0`, `@plandesk/mcp@0.10.0`). Upgrade with `npm i -g @plandesk/cli@latest`; restart `plandesk serve` — schema migrations run automatically on load (no manual migrate step). Back up `<data-dir>/workspace.db` before upgrading if you want a rollback point.

- **Goals** — a new **Goals** tab per project holds goal-altitude nodes. Every task now belongs to a Goal (`tasks.goal_id`, NOT NULL); new projects get a default **General** goal. Agents gain `create_goal`, `get_goal`, `list_goals`, `pause_goal`, `resume_goal`, and `complete_goal`. `get_next_task` walks the active Goal's frontier (optional `goal_id`; new reasons `no_active_goal`, `multiple_active_goals`). `create_task` accepts an optional `goal_id`.
- **Generalized comments** — comments are polymorphic (`target_type` + `target_id` on documents, tasks, notes, and submissions). `add_comment` now takes `{ target_type, target_id, body, passage? }`; `list_comments` takes `{ project_id, target_type?, target_id?, include_resolved? }`. The old document-only `document_comments` table is replaced by a single `comments` table. Migrations apply automatically on server start.
- **MCP tool count** — the server now lists **38 tools**. Re-run `plandesk connect` and start a new agent session so the tools and skill reload.

### 0.6.x

- **Project notes** — a new per-project **Notes** tab holds free-form, rich-text working notes, separate from documents (notes are flat, not linked to tasks, and not part of the client share). The `notes` table is added by migration `0005` and applies automatically when the upgraded server starts — your data is untouched and no manual step is needed.
- **Note MCP tools** — agents gain `create_note`, `update_note`, `get_note`, and `list_notes` (there is no `delete_note` — agents don't delete, by design). The MCP server now lists **27 tools**. Re-run `plandesk connect` and start a new agent session so the tools and the skill's new Notes section reload.

### 0.5.x

- **Zero-setup token** — `.mcp.json` no longer uses a static `Authorization: Bearer ${PLANDESK_MCP_TOKEN}` header (which warned when the env var was unset). The regenerated entry reads `.plandesk/token` automatically via a `headersHelper`; you can stop exporting `PLANDESK_MCP_TOKEN` (it still works as an override). **Re-running `connect` is required** to migrate the old entry.
- **Skill discovery** — `connect` now also installs the skill at `.claude/skills/plandesk/` and `.agents/skills/plandesk/` (symlinks to `.plandesk/skill.md`) and a `/plandesk` command at `.claude/commands/plandesk.md`. Commit these alongside the rest.
- **Markdown documents** — agents can write document bodies as Markdown; the MCP server converts them to rich text. Documents written as Markdown _before_ 0.5.0 render correctly in the updated web UI without changes.
- **Skill conventions** — the regenerated `.plandesk/skill.md` adds the "Keeping the board true" rules (atomic status updates, board↔reality reconciliation). If you customized your skill file, re-apply your edits after `connect` rewrites it.

## Pinned or npx installs

If you run Plan Desk without a global install, `npx @plandesk/cli@latest …` always uses the newest version — only steps 2–4 apply.
