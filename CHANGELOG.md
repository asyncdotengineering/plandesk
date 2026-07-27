# Changelog

All notable changes to Plan Desk are documented here.

## [Unreleased]

## [2.3.2] — 2026-07-28

### Changed

- **`workmanship.md` is 133 lines shorter by 58%** — the same nine sections, restated as thirteen numbered rules with a one-clause rationale each. It is pasted into every implementation brief, so its length is paid on every dispatch, by a worker that is often a cheaper model than the supervisor. Rules that survive skimming beat rules that read well.

- **`protocol.md` leads with the result contract.** It was under a `## Result (worker side)` heading two thirds of the way down; the JSON shape, and the three ways a result is invalid, now open the file with an instruction to reproduce them verbatim in the brief.

  This targets an observed failure rather than a hypothetical one: of 24 briefs in `runs/`, one result was written as `status: "passed"` with zero claims — not a valid status, and invalid twice over — which looks successful in a directory listing and proves nothing. The rest of the file was deliberately **not** compressed: almost every paragraph is an incident record ("a worker added `noCheck: true`… `pnpm build` then honestly reported 0 errors while hiding 334"), and those are what make a rule believable to a model inclined to reason around it.

### Added

- **`npm publish` is now refused in this workspace.** `scripts/assert-pnpm-publish.mjs`, wired as `prepublishOnly` in all four published packages, exits 1 unless the packager is pnpm.

  2.3.0 was published with npm, which leaves `workspace:*` untouched in the packed manifest — three packages shipped uninstallable and the version number was burned, since npm will not let one be reused. Nothing in the repo recorded that pnpm was required; the only place that knowledge lived was in whoever had cut the previous release. Now the tooling enforces it.

## [2.3.1] — 2026-07-27

### Fixed

- **2.3.0 was uninstallable — use this instead.** It was published with `npm publish`, which does not rewrite pnpm's `workspace:*` protocol, so `@plandesk/api`, `@plandesk/mcp`, and `@plandesk/cli` all shipped `"@plandesk/db": "workspace:*"` in their published manifests. Any install failed with `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`. `pnpm publish` resolves those to the real version at pack time, which is why every prior release was fine.

  2.3.0 is deprecated on the registry. No code changed between 2.3.0 and 2.3.1 — only how the tarball was built.

## [2.3.0] — 2026-07-27

Only `@plandesk/cli` changed; the other three republish unchanged to stay aligned.

### Changed

- **The shipped skills are now one family: `plandesk-*`.** `factory-foreman` → `plandesk-foreman`, `curator-plan-writer` → `plandesk-plan-writer`, `curator-autonomy` → `plandesk-autonomy`, and `curator-triage` + `curator-intake` merge into **`plandesk-scope-work`**. Triage and intake were two entry shapes of one verb — a pile of items that already exist, or one idea that needs breaking down — and splitting them forced the caller to pick before knowing which they had. One skill, two modes, one set of drafting rules.

  Two prefixes meant every request began with a routing decision, and a wrong route is expensive: a real session reached for `curator-plan-writer` with 29 items, got a correct refusal (27 of 29 were below the RFC threshold), and fell through to bare `create_task` — outside every readiness bar the project keeps. Both refusal paths now hand off explicitly instead.

- **`doctor` reports `skills + hooks: N/N present`** where it said `curator: N/N artifacts present`. The count includes the four hook files, so the old label was doubly wrong once no skill was named curator.

### Added

- **`plandesk-groom-task`** — grooms one thin task, or a bare one-line requirement with no card yet, into a build contract **in place**. This was the hole: `plan-writer` needs an RFC-worthy change, `scope-work` drafts only at creation time from whatever the source carried, and the foreman grooms only as a prelude to dispatch. A one-liner dropped on the board mid-week had no entry point at all.

  It also owns the **Definition of Ready**, which had forked four ways — a 3-item rubric in `.plandesk/skill.md`, a 6-item one in the shipped template, a third inside triage, and prose inside the foreman. `scope-work` and `plandesk-foreman` now link it instead of restating it. `.plandesk/skill.md` keeps the *shape* of a description; groom-task owns the *verdict* on whether it is good enough yet.

- **`plandesk-timebox`** — pomodoro pacing over a work list you define, chainable onto another skill (`/plandesk-timebox 25m /plandesk-foreman next`). The interval is a checkpoint cadence, never a kill signal: an expiring box lets the in-flight item finish, verify and commit before reporting. A box that cuts through a dispatch strands work in the one state no report can honestly describe.

- **`plandesk-autonomy` is now invocable and chainable** — `/plandesk-autonomy /plandesk-foreman all todo`. It grants pace, not permission: a wrapped skill's lane gates and boundaries bind unchanged.

### Removed

- **`curator-provenance`** — the `{ sources, reason }` convention now lives inside `plandesk-scope-work`. A skill defining a two-field shape did not earn its own entry.
- **`curator-automation`**.

### Fixed

- **`.plandesk/skill.md` was 22 lines behind the shipped template** — the repo's own copy carried the 3-item task rubric while consumers received the 6-item build contract. It is regenerated from `buildSkillMarkdown()` and byte-identical to what `connect` writes.
- Docs described a `.agents/curator/` layout that has not existed for some time — the skills location, the hook paths, and the setup checklist in `start.md` all pointed somewhere real users would have found empty.

### Upgrading

`plandesk factory sync --write` adds the new skills but **will not remove the old ones**: everything under `.agents/skills/` is a shared namespace, so prune deliberately never deletes there (that is what protects skills installed with `npx skills add`). After syncing, delete the superseded directories and their `.claude/skills/` links by hand:

```bash
rm -rf .agents/skills/{curator-triage,curator-intake,curator-provenance,curator-automation,curator-autonomy,curator-plan-writer,factory-foreman}
rm -rf .claude/skills/{curator-triage,curator-intake,curator-provenance,curator-automation,curator-autonomy,curator-plan-writer,factory-foreman}
```

Leaving them costs more than clutter: the stale `curator-triage` and the new `plandesk-scope-work` both trigger on "triage the backlog", and two skills answering one request is how a plan drifts.

## [2.2.1] — 2026-07-27

Only `@plandesk/cli` changed; the other three republish unchanged to stay aligned.

### Fixed

- **`factory sync` now links newly shipped skills.** A skill that shipped after a repo was initialised landed in `.agents/skills/` and stayed unreachable: agents read `.claude/skills/`, and sync refreshed generated artifacts with `.filter((artifact) => artifact.action === 'update')` — precisely the set that already exists. A missing link is marked `create` and was filtered out, so sync wrote the skill file and never linked it.

  Observed on eight repos after `factory-foreman` shipped in 2.1.0: the file present, committed, and not one of them able to invoke `/factory-foreman`. Only re-running `factory init` fixed it, which nothing told anyone to do.

  `create` now belongs in that filter alongside `update`; `skip` is still excluded, because that is the create-once authored policy. Sync reports which links it made, since a silent repair leaves you unable to tell it was ever broken.

  **If you scaffolded before 2.1.0, run `plandesk factory sync --write` once** — it will create the missing links and say so.

## [2.2.0] — 2026-07-27

Only `@plandesk/cli` changed; the other three republish unchanged to stay aligned.

### Added

- **A lightweight decision-record form in `curator-plan-writer`.** The skill could already record a decision — it names driver, approver and consulted parties — but every decision went through the full 11-section RFC, most of which is meaningless once the call is made: there is no decomposition to sketch and no verification surface, because nothing is being built. That collides with the skill's own threshold ("ceremony that outweighs the decision is the failure mode"), and the observable result is the decision not being written down at all. The short form is Context / Decision / Consequences, chosen by one question the agent can actually apply: **is anything going to be built from this?** Yes is an RFC, no is a decision record. `Decision:` joins the shipped document title prefixes.

- **`plandesk doctor` reports factory staleness, not just presence.** A scaffolded file can be present and several releases behind, which turned out to be the common state — across nine repos, seven were on 5 of 25 policy files and nothing ever told them. Doctor now shows both, reusing the same comparison `factory sync` runs so the two cannot disagree:

  ```
  factory: 25/27 policy files up to date — 2 behind, run `plandesk factory sync --write`
  ```

  Chosen over building a notification system because doctor is already what people run when something feels off. One line on an existing habit beats a mechanism nobody remembers to install.

### Fixed

- **The breadcrumb reaches the open document or note.** On a document page the trail read `Workspace › Project › Documents` and stopped, so the deepest crumb named the list you had navigated away from and the open document appeared nowhere; the page compensated with a lone back arrow that discards the path above it. The trail now grows a leaf for the open record, and the view label becomes the link back to its list. Notes had the identical shape and are fixed too.
- **`factory init` and `factory sync` refuse to run inside Plan Desk's own source tree.** There `.agents/` is the source that `dist/templates` is built from, not a scaffold, so scaffolding writes the output shape back over the input. Found by doing it: a sync run wrapped `.agents/index.md` in the sentinel markers the CLI is supposed to insert, so the template then carried its own markers and every consumer would have received two.
- **The shipped `.codex` factory adapter pointed at retired files** — `workflow.md` and `autonomous-stand.md`, both removed in 2.0.0.

## [2.1.1] — 2026-07-27

Ships a shipped-policy fix that missed the 2.1.0 tag by one commit, plus the documentation for what 2.1.0 introduced. Only `@plandesk/cli` changed; the other three republish unchanged to stay aligned.

### Fixed

- **The suppression sweep failed honest work.** `protocol.md`'s check for gate-silencing edits used an unanchored `xit\(`, which matches the tail of `process.exit(`. Any dispatch that added a CLI exit code was rejected as if it had suppressed a test. Found by running the factory: a worker implementing an exit-code contract wrote `process.exit(broken > 0 ? 1 : 0)` and its clean dispatch was refused. A gate that fails honest work teaches people to stop running it.
- **Stall detection could kill a healthy worker.** The check said `ps -o time= -p <pid>` without saying *which* pid. A worker launched through a shell wrapper leaves the parent parked at ~0.01s of CPU while the child does the work, so the check reported "flat" every time. It now says to sample the leaf, gives the command to find it, and notes that some worker CLIs flush their log in bulk — so silence alone is not a stall signal.
- **`pnpm validate` is green for the first time.** It was failing on 577 accumulated eslint errors (`cli` 221, web 170, `api` 128, `mcp` 58) and, behind those, on a call to `plandesk token create` — a command that has not existed since before 2.0.0. The step had been unreachable, so nobody noticed. No token is needed: `validate` binds loopback, and a loopback bind is the local trust boundary. This matters beyond tidiness — the guard that keeps the shipped skill documentation in sync with its source lives inside `validate` and could never run while the suite was red.

### Documentation

- **`reference/factory.md` documents the conductor.** It described a factory with no way to run one. Now covers the `.agents/skills/` tree, `/factory-foreman` and its cycle, `workmanship.md` as the worker-side bar, and the curator family — all of which shipped in 2.1.0 undocumented.

### Changed — shipped policy

Four lessons from running the factory against a real project, recorded where they will be read rather than in a commit message:

- `protocol.md` names **the engine as the second writer**. "One dispatch at a time per repo" applies to the supervisor too: five policy files edited during a live dispatch were reverted and unrecoverable, because none were staged. Stage every edit as you make it, or stay out of the tree until the dispatch returns.
- `workmanship.md` gains **"finish the work, do not describe it."** A headless worker that ends on "I'll run the tests now" delivers nothing while reading as complete.
- `brief.md` gains **"say why, not only what."** A brief that states the change without the intent forces the worker to infer one, and it infers wrong exactly where the judgment matters.
- `workers/grok.md` and `workers/pi.md` record two failure modes seen live: grok exits 0 having written nothing when a free-tier limit is hit, and pi flushes its log in bulk.

## [2.1.0] — 2026-07-26

Only `@plandesk/cli` changed. `db`, `api` and `mcp` are republished at the same version with no changes, because 2.0.0 promised the four move together so the number alone answers "which versions go together".

### Added

- **`factory-foreman` — the skill that runs the board.** The factory had policy for every phase of a run and nothing that ran one: `factory.md`, `protocol.md`, `slicing.md` and `brief.md` describe the cycle, the dispatch contract, WBS slices and live share-link context, but they ride in context as prose a supervising agent is expected to internalise. There was no invocable entry point, so the unattended path — hand off a ticket, walk away, come back to a commit — did not exist. `factory-foreman` is that entry point: preflight, resolve scope, groom, slice, dispatch, stage-then-verify, commit per slice, review, lane gate, loop. Invoke it with a task id, `next`, `all todo`, or a goal name, optionally `--to <worker>`.

  It conducts rather than restates — every policy it needs is linked, because a fourth copy of the cycle is exactly the overlapping-authority problem that collapsing `workflow.md` into `factory.md` removed. **Grooming stays inline and only implementation dispatches:** grooming is judgment about intent, and handing that to a worker is how a plan drifts from what was actually wanted.

- **`.agents/factory/workmanship.md` — the worker-side standard**, prepended to implementation briefs. `protocol.md` covers the engine verifying a worker *after* a dispatch; nothing told the worker the bar *before* it started, so a dispatch could only discover the standard by failing verification. Covers no workarounds, never claiming done without proof, tests that fail first, surgical changes, never destroying work it did not create, and honest reporting. Self-contained by necessity — a consumer machine has none of an operator's personal contracts.

- **Two skill families.** `.agents/skills/` now reads as the model: `curator-*` plans, `factory-*` executes.

### Fixed

- **Curator skills had 21 dead cross-links.** They were written for the retired flat `.agents/curator/*.md` layout and never updated when skills moved to `.agents/skills/<name>/SKILL.md`, so `[triage.md](triage.md)` resolved to a sibling of the file citing it. Two also hardcoded `.agents/curator/triage.md`, a path that ships nowhere. Every link now resolves — verified in a scaffolded consumer repo, not only in this one.
- **No skill was slash-invocable.** None declared `user-invocable`, so `/curator-triage` did nothing and skills could only fire on a description match. The four entry points (`curator-triage`, `curator-intake`, `curator-plan-writer`, `curator-automation`) now declare it with argument hints. `curator-autonomy` and `curator-provenance` stay reference-only on purpose — they are conventions other skills cite, and offering a command that does nothing is worse than offering none.

## [2.0.0] — 2026-07-26

All four published packages move to **2.0.0** together and stay aligned from here on. Previously they drifted (`db` 1.0.0, `api` 1.0.6, `mcp`/`cli` 1.0.7), which made "which versions go together" a question you had to answer by reading the changelog. Now the answer is the number.

`@plandesk/mcp-client` stays at **1.0.0** — nothing in it changed.

### Breaking — one link shape

- **A document can now be linked to many tasks, and documents can link to each other.** This is the headline feature and the reason for the major bump. Previously `documents.linked_task_id` allowed exactly one task per document, and edges could only join task to task.
- **`edges` are polymorphic.** The table gained `from_type` / `from_id` / `to_type` / `to_id` (each `'task' | 'document'`), replacing the task-only foreign keys, with both directions indexed. This mirrors the `comments` table's existing `target_type` / `target_id` precedent rather than inventing a new pattern.
- **`linked_task_id` is gone** from the document payload in the REST API and the MCP tools, and `linkedTaskId` is gone from the `documents` table. Read `links` (outgoing) and `backlinks` (incoming) instead — each entry is `{ type, id, title, label, edge_id }`. `share_submissions.linked_task_id` is deliberately retained; it is a different concept (which task a guest submission targets) and is unaffected.
- **The edge label vocabulary grew** for document sources: `documents`, `references`, `supersedes`, `extends`, alongside the existing task vocabulary.
- **Migration is automatic and was verified against a real board.** Every existing `linked_task_id` becomes a `document → task` edge labeled `documents`. On a copy of the development board: 443 task→task edges preserved, 129 document links converted to exactly 129 doc→task edges (572 total), 0 null endpoints, 0 foreign-key violations, and the migrated schema is byte-identical to a freshly created one.

### Breaking — export format

- **The export format is now v3, and the importer accepts a set of versions rather than one.** The importer previously compared with equality, which meant bumping the version would have orphaned every export file already on disk — so nine features had been bolted on as optional fields instead of bumping. That is fixed: `SUPPORTED_EXPORT_VERSIONS` gates the import, so the format can evolve without stranding files.
- **Export/import no longer silently drops document links.** `PlandeskExportV1Edge` never carried typed endpoints, so an export → import round trip discarded every document link. Now carried and restored.

### Breaking — factory

- **One factory operating contract.** `workflow.md` and the untracked workhorse rewrite are gone; `factory.md` is the single always-on mode — the proven serial loop (pull → read → red gate → delegate → prove → observe → gate → ship) plus the agent-run lifecycle (`start_agent_run` / `record_agent_progress` / `complete_agent_run`) that used to live only in `workflow.md`. `autonomous-stand.md` is renamed to `execution.md` so "autonomy" means board authority only. Multi-slice companions ship as `slicing.md` / `brief.md` / `heartbeat.md` (linked extensions, not the default). The always-on sentinel, `/factory` command, skill template, onboarding, and docs follow the new tree. Existing repos: `plandesk factory sync --write` creates the new files; drop or rename retired ones yourself (sync does not delete user-edited paths without `--prune`).
- **`factory init` reclaims Plan Desk hook entries in `.claude/settings.json`.** Each shipped hook entry now carries a `_plandesk` ownership marker. `mergeCuratorHooksJson` drops every marked entry and re-inserts the current snippet set, so a path or matcher change no longer leaves a stale entry firing forever. Untagged (user) hooks are never touched. **One-time legacy sweep:** untagged entries whose `command` still contains `.agents/curator/hooks/` are also dropped so pre-marker installs converge on first run — remove that path match after one release cycle once consumers have upgraded.

### Fixed — hosted

- **A hosted board now serves MCP.** The Workers entry never passed an MCP app into `createApp`, so `/mcp` was unmounted on the hosted deployment: `plandesk connect --to <org>` minted a workspace-scoped agent key and wrote an `.mcp.json` pointing at a URL that could not serve a single tool. Local `plandesk serve` was never affected (the CLI already composes both). Not an oversight — `@plandesk/mcp` imports runtime values from `@plandesk/api`, so `api` could not import `mcp` back without a dependency cycle. The Workers entry now lives in a new deploy-only package, **`@plandesk/worker`**, which depends on both and composes them, mirroring `serve.ts` on Node. Self-hosters deploying to Cloudflare now run `wrangler deploy` from `packages/plandesk-worker` (see the updated Cloudflare runbook); the worker name, bindings and asset path are unchanged. No published package changed behavior.

### Added

- **`.agents/` is the source of truth for shipped policy.** The factory and curator templates used to live as string constants in the CLI's TypeScript, with a byte-identical guard against `.agents/`. That inverted: `.agents/` is the real directory, and the CLI build copies it into `dist/templates` for `factory init` to distribute. One place to edit, no drift possible.
- **`.agents/` is treated as a shared namespace.** `factory init` writes only into paths Plan Desk owns and never overwrites files it did not author — other tools' agent config in the same directory survives. Curator skills moved to the conventional `.agents/skills/` home and are symlinked into `.claude/skills/`.
- **`POST /api/v1/projects/:id/edges`** creates a typed edge over HTTP, taking `{ from_type, from_id, to_type, to_id, label?, style?, arrow_direction? }`. Deleting a single link is `DELETE /api/v1/projects/:id/edges/:edgeId` with the `edge_id` from a `links` / `backlinks` entry — no re-fetch, no matching on endpoints.
- **Links and backlinks in the web UI.** A document shows what it points at and what points at it, each entry navigating to its target; a task shows every document linked to it, replacing the single-document slot. The link picker chooses target type, searches within the project, and picks a label from the vocabulary. The Flow canvas stays task-only by design.
- **The MCP link surface describes itself.** `delete_edge`'s `edge_id` now names where an agent obtains it, so the `get_document` → `edge_id` → `delete_edge` chain is discoverable from the tool list alone. `get_document`, `list_edges` and `create_edge` declare an `outputSchema` and return `structuredContent`, so a client knows the shape without calling first. Annotations were audited across all 48 tools.

### Fixed

- **`plandesk factory init` crashed on every npm install.** npm rewrites a packaged `.gitignore` to `.npmignore` when it *installs* a package, so `factory/runs/.gitignore` was present in the tarball and gone by the time anyone ran the CLI — `factory init` died with `ENOENT`. This was invisible to every gate: the repo build, all five test suites and `pnpm pack` each see the file; only a real `npm install` of the tarball reproduces it. It arrived with the move of templates from TypeScript string constants into shipped files — a constant cannot be mangled, a file can. Templates are now vendored de-dotted, the build **fails** if any dotfile remains under `dist/templates` so the next one cannot ship silently, and the reader resolves either spelling.
- **A local board behaves like one on `localhost`, not just `127.0.0.1`.** Opening `http://localhost:7526/` returned unauthenticated and could not reach workspaces, while `http://127.0.0.1:7526/` worked — the same server, two different answers. A loopback bind is what makes a local board zero-setup (every request is the org owner, no login), but the check ran only when better-auth had no opinion, and better-auth answered `unauthorized` for `localhost` first. Loopback is now decided before that answer is consulted. The check tests the *server's bind address*, never a caller-supplied `Host` header, so it cannot be spoofed from outside.
- **Task shares and task→document lookup see edge-linked documents.** A document linked through the new edge path was silently omitted from a task's share bundle and invisible to `getDocumentByTask`, because both still read the legacy column. Found with a purpose-built repro that linked two documents to one task by *different* mechanisms and diffed what each surface returned.
- **`plandesk context` resolves the linked document through edges.** It feeds `session-start.sh`, so the wrong answer here silently degrades every agent session's starting context.

### Documentation

- **The bind address is named as the trust boundary.** A loopback bind means every request is the org owner with no login. So binding loopback behind a reverse proxy — normally good practice — defeats the model: the server still believes only this machine can reach it while the proxy hands the internet an owner session. There is no error and nothing looks wrong. Both self-hosting guides now state the two safe shapes explicitly.

## [1.0.7] — 2026-07-19

Two agent-experience papercuts found while exercising the full MCP surface against a migrated board. `@plandesk/mcp` and `@plandesk/cli` only — the hosted Worker is unchanged.

### Fixed

- **`create_goal` documents its `verification_surface` shape.** The parameter only named the three kinds, so the first call failed with `verification_surface must include a kind` and an agent had to read the service source to discover the JSON. The tool schema now spells out all three surface shapes (`gate_command` / `acceptance_checklist` / `human_sign_off`) and the matching `complete_goal` evidence shapes.
- **`connect` warns when an ancestor `.mcp.json` shadows the one it writes.** An agent session opened from a parent directory reads *that* directory's `.mcp.json`, so the config `connect` just wrote is silently ignored — observed live, where a parent `.mcp.json` still pointed at a dead port after a successful connect. `connect` now detects the shadowing file and names it, with the fix.

## [1.0.6] — 2026-07-19

### Fixed

- **Workspace switching works on a local board.** A local (loopback) board has no session to persist the active team, so `set-active-team` returned 401 and the active workspace stayed pinned to the server-computed default — clicking any workspace always opened the same one. A client-side active-workspace override now drives the selection (persisted per browser), routed through one `useActiveWorkspace()` hook so the projects list, breadcrumb, both sidebar switchers, and the account menu all agree.

## [1.0.5] — 2026-07-19

More fixes from live 1.0 use — a navigable breadcrumb and a connect token bug.

### Fixed

- **Topbar breadcrumb is now navigable.** The breadcrumb rendered the project name as a plain span, so the top-left was a dead end. It's now a real trail: the workspace name links to the landing (to switch workspace), the project name links to its overview, and the current tab stays bold.
- **`connect` no longer leaves a stale token on a local rebind.** A repo previously connected to a different server kept that server's key in `.plandesk/token`; a local `connect` reused it, so the MCP sent an invalid Bearer and every call returned 401. Local loopback needs no token (the server treats loopback as owner) — connect now removes any stale token instead of reusing it.

## [1.0.4] — 2026-07-19

Two web fixes surfaced by live 1.0 use.

### Fixed

- **Flow route no longer crashes on mount.** `FlowCanvas` referenced a `useCallback` in an effect dependency array before its declaration, so opening a project's **Flow** tab threw a temporal-dead-zone error (`Cannot access … before initialization`) and rendered the router's "Something went wrong!" boundary. Present since the flow redesign — every user opening Flow was affected. Hoisted the callback above the effects that consume it.
- **Workspace landing loads on a local board.** `listWorkspaces` / `createWorkspace` called better-auth's session-only team endpoints, which return 401 on a local loopback board (no session) — the landing showed "Failed to load workspaces". Both now route through the loopback-capable REST endpoint (`GET`/`POST /orgs/:id/workspaces`), which serves loopback, hosted session, and owner keys alike.

## [1.0.0] — 2026-07-18

The workspace tier: planning now spans **Org → Workspace → Project**, implemented as a fully-native better-auth team. General availability — `@latest` moves to `1.0.0`, and the default port moves to `7526`.

### Added

- **Workspaces.** A **Workspace** sits between Org and Project as a native better-auth team (`team` / `teamMember`): an org has many workspaces, a workspace has many projects and members. Each org gets a default "General" workspace, and projects gain `projects.workspace_id` (one workspace each). Solves agent isolation, multi-project folders, workspace membership, and the active-workspace switcher in one concept.
- **Workspace-scoped agent keys + `connect --workspace`.** `plandesk connect --workspace <name|slug>` binds a repo to one workspace and mints a **workspace-scoped** key — all projects in that workspace, nothing else in the org. Enforcement extends the existing project 404 guard with `assertProjectInWorkspace`: a project outside the scoped workspace returns the same 404 (no existence leak). Owner keys skip it.
- **Workspace invitations + client sharing.** Invitations and the client portal move to the workspace level: invite a person (or client) to a **workspace** with a role, and share an entire engagement with a client — their portal shows every project in that workspace (read-only, submit-if-allowed). Reuses the guest-session + `ClientView` machinery, widened from one project to a workspace.
- **Dashboard workspace management.** A nav switcher (Org ▸ Workspace ▸ Projects, backed by `setActiveTeam`), workspace CRUD, move-project-between-workspaces, member management (add / remove / list), invite-to-workspace, and share-workspace-with-client.
- **`plandesk legacy-upgrade --into-workspace <name>`** imports an old board's projects into a workspace (creating it; defaulting the name to the folder name when omitted), so a multi-project folder lands together. New `plandesk workspace create|list` commands round out the surface.

### Changed

- **Default port is now `7526`** (was `3847`). Still one global board per machine; `serve` uses the fixed port and fails if it is busy — free the port or pass `--port`.

### Security

- **Comprehensive cross-org / cross-workspace tenant-isolation hardening**, verified by 4 adversarial audit rounds (41 isolation tests): a workspace-scoped key cannot read any project outside its workspace (same-404, no existence leak); members cannot reach workspaces they don't belong to; non-owner/admin invitations are blocked; and a workspace client share exposes exactly that workspace's projects and nothing else.

## [1.0.0-beta.8] — 2026-07-18

Build hygiene + dead-code cleanup. No runtime behavior change.

### Fixed

- **Cleaner published packages.** Each package now wipes `dist/` before compiling (`rm -rf dist && tsc`), so orphaned build outputs never ship. Earlier beta tarballs of `@plandesk/api` carried stale compiled `events.*` files from the removed SSE stream; they're gone now.

### Removed

- Dead Server-Sent-Events remnants left over from the switch to polling: the SSE latency path in `scripts/metrics.mjs` (it measured the deleted `/api/v1/events` route), vestigial `EventSource` test stubs, and the stale compiled `events.*` artifacts. Reference docs were also corrected to describe polling (`~2.5s`) rather than SSE across the board.

## [1.0.0-beta.7] — 2026-07-18

Second (and final) pass of the web user-flow audit — clears the 36 remaining items, so every one of the 134 audited flows now passes or is fixed (`AUDIT-SUMMARY.md`).

### Changed

- **Plainer language, less agent jargon.** Task lanes now have a plain-English gate tooltip and an in-drawer selector; the short task id has a tooltip; dependency edges get an editable relationship picker with friendly labels ("depends on", "feeds into", …); "Release to scope" → "Send to planning"; portal dependencies read as sentences ("Design must finish before Build"); the guest issue form picks a task by name instead of a raw id; the no-GitHub sign-in copy is friendlier.
- **Controls you couldn't reach are now reachable.** Board card actions, the rename pencil, and image "Annotate" no longer require hover (touch- and keyboard-accessible); Share and note-Delete are available while reading, not only while editing; task tags work on the canvas; merging a submission uses a task picker.
- **Dark mode + consistency.** The formatting toolbar follows the theme (was hardcoded light); "File an issue" no longer duplicates its label; the command palette includes Documents; and the **board task drawer now has a comments rail** (task comments were previously unreachable from the board).

### Fixed

- **Missing states filled in** — board loading skeleton, empty-canvas and empty-portal hints, a next step on dead share links, a breadcrumb placeholder, an "Approving…" label, a sign-in retry when options fail to load, a clear message (instead of a vanishing form) when a guest can't submit, a warning when an image can't be uploaded and is embedded inline, a hint when "attach selection" has nothing selected, keyboard delete for canvas nodes, doc-row status on small screens, and a persistent (retryable) error when a share link fails to create.

## [1.0.0-beta.6] — 2026-07-18

UX hardening from a full four-phase audit of every web user flow (see `AUDIT-SUMMARY.md`). This release ships the "clear defects" batch.

### Fixed

- **Silent failures now surface.** A global mutation error handler shows a toast when any create / rename / delete / status-change / tag / move / org-switch / logout request fails — previously ~20 of these failed silently, leaving the UI looking like nothing happened.
- **Loading and error states no longer masquerade as "empty."** The project overview's Goals and Recent-documents sections, and the documents panel, now show real loading/error states instead of an "empty" message when a fetch is pending or failed.
- **Dead and misleading controls.** The sidebar workspace "switcher" (a dropdown chevron that did nothing) is now an honest link to home; the Inbox "Looks good" button on Curator proposals (a no-op that lost its state on reload) is removed and its note links to the Board; the **MCP Settings** page now actually has the "Connect an agent (MCP)" section it advertised, with copyable `plandesk login` / `plandesk connect` commands and a docs link.
- **Destructive actions confirm.** Rejecting a client submission, running Auto-layout (which replaces your manual node arrangement), and baking a permanent blur-redaction now ask first.
- **Clipboard.** Copy actions catch failures (and tell you to copy manually) and reset the "Copied" label; sharing a task/document now copies the human page URL instead of the raw `.md` URL.
- **Editor discoverability.** The empty-editor placeholder now hints that `/` opens the block menu and `[[` links a document.
- **GitHub sign-in button** uses the real GitHub Octocat mark (was an ambiguous glyph).

## [1.0.0-beta.5] — 2026-07-18

### Fixed

- **Invite links now work end to end.** The claim link an owner/admin hands out (`/invite/:invitationId`) previously led nowhere — there was no page to render it, and the path sat inside the auth wall, so a signed-out invitee was bounced to sign-in, `accept` was never called, and the invitation stayed pending forever. There is now a real claim page: it previews *"you've been invited to join **{org}** as **{role}**"*, then walks the invitee through GitHub sign-in (returning to the invite) and accepting, landing them in the workspace. Clear states for expired/already-used links and wrong-account mismatches.

### Added

- **`GET /api/v1/invitations/:invitationId`** — a capability-gated preview (the unguessable id is the authorization; no session required) returning the organization name, role, invited email, and status, so the claim page can orient an invitee before they authenticate.

### Changed

- **Redesigned the sign-in and invite pages.** Both now share a branded, full-viewport, centered frame with the Plan Desk node-graph mark, wordmark, and a subtle canvas backdrop — matching the marketing site. Sign-in copy leads with product identity ("Welcome to Plan Desk — the shared graph for planning and building") and a GitHub button with a reassurance line ("We only read your public profile and email"), replacing the bare, off-center card and org-jargon subtext.

## [1.0.0-beta.4] — 2026-07-18

### Changed

- **Admins can invite teammates.** Invite authority now covers **owners and admins** (previously owner-only): both can invite as `member` or `admin`. Only owners can mint other owners — better-auth blocks a non-owner inviting an owner. Members still cannot invite. The invite route now checks `invitation:create` (admins gained it) instead of `member:create`; direct member management (`member:update`/`delete`) stays owner-only.
- **Members page hides the invite card for non-inviters.** A member (who cannot invite) now sees only the roster — the invite form is hidden entirely rather than shown with a disabled "only owners can invite" note. Owners and admins see the invite form.

## [1.0.0-beta.3] — 2026-07-18

Production-hardening pass on the hosted control plane.

### Added

- **Dashboard member invites.** A new **Settings → Members** page lists an organization's members and, for owners, invites a teammate by email + role (admin / member). Invites are link-only (no mailer): the returned claim link is shown with a copy button to deliver by hand. Non-owners see the member list but not the invite form; the API rejects non-owner invites regardless (`POST /api/v1/orgs/:id/invitations`, owner-only). Backed by a new `GET /api/v1/orgs/:id/members` (caller must belong to the org).
- **`plandesk admin invite-owner --db <url> [--db-token <t>] [--secret <s>]`.** Bootstrap the first owner of a **remote** (Turso/libSQL) hosted instance from the shell, without local workspace state. The secret must match the deployed instance's `PLANDESK_BETTER_AUTH_SECRET` (flag or env); run `plandesk migrate` against the remote DB first. The local `--data-dir` form is unchanged.

### Fixed

- **File storage on Cloudflare Workers (R2).** File uploads now work on the hosted Worker via the native R2 binding (`env.FILES`) instead of requiring S3 API credentials. `put` persists the file-metadata row (so uploads no longer fail with "did not persist file metadata"), and `resolve` is org-scoped through the same `getFileInOrg` path as the local/S3 adapters — the bare content hash is never a lookup key, so one tenant cannot read another's bytes by knowing the hash.
- **`GET /api/v1/health` is public.** The health endpoint no longer requires authentication, so uptime monitors can reach it on a hosted (non-loopback) instance. Only the health path was made public; every other route still requires a session or key.

## [1.0.0-beta.2] — 2026-07-18

### Fixed

- **Cloudflare Workers deploy.** Fixed three module-load failures found deploying the beta to Workers: lazy `fileURLToPath(import.meta.url)` (version()/migrations folder) so the Worker bundle no longer throws at load; storage is optional on the Worker entry (no crash when S3/R2 creds are absent); strip the SPA `_redirects` that conflicts with wrangler `not_found_handling`.

## [1.0.0-beta.1] — 2026-07-18

First beta of the better-auth-native rewrite — hosted control plane, two-actor auth, and the legacy-board migration path. Published under the `beta` npm tag; `npm i -g @plandesk/cli@beta`.

### Breaking

- **Auth is entirely better-auth (native rewrite).** Web: GitHub social sign-in → better-auth session. CLI: human pastes a dashboard-minted org-wide owner API key via `plandesk login`; `plandesk connect --to <org>` mints a project-scoped agent key into `.plandesk/token`. Agents never log in. Local loopback remains zero-auth owner. **Removed:** `mcp_tokens` and `/api/v1/mcp-tokens`, GitHub device-flow CLI login (`/auth/device/*`, github.com/login/device), hand-rolled session cookies / OAuth, and `X-Plandesk-User-Ref`. **Orgs:** legacy `orgs` / `org_members` are gone — better-auth `organization` / `member` (roles as permission sets: owner / admin / member) are the single org source of truth. **Schema reset:** the Drizzle migration baseline was replaced; **existing databases must be re-initialized** (no in-place migration). Operators: drop/recreate the DB (or provision a fresh one), run migrations / `plandesk init` as appropriate for your topology, sign in on the dashboard, regenerate any CLI owner keys, re-run `plandesk login` and `plandesk connect --to <org>` for each bound repo. (BA7 / better-auth-native.)
- **`@plandesk/sync-server` removed.** Guest portal join, view, and moderated submissions run on **`@plandesk/api` only** (`POST/GET /api/v1/share/:token/submissions`, guest-session gated). There is no separate portal/sync process and no `VITE_SYNC_URL` / `SYNC_BASE`. Redeploy self-hosted setups as a single Plan Desk API; drop any dual-server topology. (BA6 / RFC §13.5 — one hosted paradigm.)

### Added

- Guest **submit** and **list-own-submissions** on plandesk-api (same guest session as portal view). Owner triage works without a remote sync hop when submissions land on the same database.

## [0.20.0] — 2026-07-12

### Added

- **Share links in the UI.** Tasks and documents now have a **Share** action (task drawer + document editor): pick a TTL (24h / 7d / never), create the link, and copy the public, read-only `…/share/<token>.md` URL — the same agent-ready Markdown the `create_share_link` MCP tool produces, now mintable by a human without touching MCP. New REST endpoints `POST /api/v1/tasks/:id/share` and `POST /api/v1/documents/:id/share` back it.
- **`plandesk factory sync`.** Update a repo's scaffolded factory/curator policy to the latest shipped version **without clobbering your edits**. Authored files (`.agents/factory/*.md`, `.agents/curator/*.md`) are create-once, so shipped improvements never reached existing repos before; `sync` classifies each file as up to date / create (missing) / **safe update** (unmodified since scaffold → updated) / **customized** (you edited it → kept), using a small manifest (`.agents/.plandesk-sync.json`) to tell edits from staleness. Default is a dry-run plan; `--write` applies creates + safe updates and keeps customized files; `--force` also overwrites them. On apply it refreshes the generated sentinel block and adapters too, so it's a one-stop upgrade. See [Upgrading](https://plandesk.asyncdot.com/reference/upgrading/).

## [0.19.0] — 2026-07-12

### Added

- **Scaffold into an existing project.** `scaffold_project_from_plan` now takes an optional `project_id`: pass it to add a whole plan — tasks, dependency edges, linked documents — **atomically into an existing project** (e.g. the repo-bound one), with new auto-laid-out tasks placed below its existing nodes; omit it to create a new project (as before). This removes the friction of an agent either duplicating an already-bound project or falling back to granular `create_task`/`create_edge`/`create_document` calls. The intake and connect skills now direct agents to pass `project_id` when the repo is already bound.

### Changed

- **Factory hands workers context by link, not by paste.** The dispatch contract (`.agents/factory/protocol.md`) now instructs the supervisor to mint a share link (`create_share_link`) for the task being delegated and put the `markdown_url` in the worker's brief — so a worker CLI with no MCP access `curl`s one URL for the full task, its inlined specs, and image references. Delegation no longer requires the operator to name any tool.

## [0.18.0] — 2026-07-12

### Added

- **`plandesk onboard`.** A portable teach-me guide that explains the Plan Desk + Factory model to a coding agent — how the board works, the execution loop, delegation, and the MCP tools — without assuming any personal delegate skill or worker CLI exists on the machine. Wired into `plandesk help` / `--commands` and referenced from the connect skill.
- **`curator-plan-writer` skill.** A new Curator skill that writes an RFC as a Plan Desk `Design:` document — an evidence-backed build contract (problem, numbered requirements, concrete design, alternatives, verification surface) that is the upstream of `curator-intake` (which decomposes it) and the factory (which executes it). Synthesized from how mature open-source projects (Sentry, Ember, React, the Vercel / AI SDK ecosystem) write RFCs; respects intake's ownership of task sizing.

### Changed

- **Leaner always-on agent context.** `factory init`'s managed `CLAUDE.md` / `AGENTS.md` block now inlines a crisp "default operating mode" preamble plus exactly one policy doc — `factory.md`, the per-item contract whose absence would change behavior. The session program (`workflow.md`) and execution posture (`autonomous-stand.md`) are referenced by path and read on demand instead of inlined into every session (~496 → ~266 lines of baseline policy). The preamble carries a **portable delegation default**: delegate implementation to a probed worker when one is installed, else do the work yourself under the same contract — never assuming a delegate skill or worker CLI this repo did not ship.
- **Sharper execution posture.** `autonomous-stand.md` adds a concrete anti-early-stopping check (before ending a turn, if your last paragraph is a plan, a question, or an "I'll…" promise, do that work now with tool calls); `factory.md` frames diff review as adversarial (assume the worker missed something and prove it did not; never approve a first pass unexamined).

### Fixed

- CLI test isolation: the `commands` and `sync-cli` suites no longer race on the machine-global port registry under parallel runs.

## [0.17.0] — 2026-07-12

### Added

- **File storage.** Uploads now go through a pluggable `StorageAdapter`; the default `local` adapter stores content-addressed BLOBs **inside `workspace.db`**, so a self-hosted install needs no object store and files travel with sync/backup/export. `POST /projects/:id/files` (base64, ≤10 MB) → a lean `/api/v1/files/:id` URL; `GET /files/:id` serves it (`image/*` inline, everything else forced to download so an upload can never execute as active content). MCP **`attach_file`** lets an agent upload once and embed `![](url)` instead of inlining base64. The editor now uploads pasted/dropped and annotated/redacted images to file URLs (via TipTap's `FileHandler`) so bodies stay lean.
- **Agent share-links.** `create_share_link` (MCP) mints a public, hash-token link scoped to one task or document with a TTL (24h default, or `never`). `GET /api/v1/share/:token.md` returns it as **agent-ready Markdown** — linked documents inlined, an instruction to fetch every embedded image, and relative URLs absolutized — so a delegated worker can `curl` full task/RFC context without any MCP access. Reuses the existing `shares` table + projection.
- **First-class artifacts.** Stored agent deliverables (markdown/html): `create_artifact` / `get_artifact` / `update_artifact` / `list_artifacts` (MCP) and `POST/GET/PATCH /artifacts` + `GET /projects/:id/artifacts` (REST). The stored artifact's id is the same `artifact_id` used by `list_artifact_comments` / `add_artifact_comment`, closing the produce → annotate → revise loop.
- **Full editor in task descriptions.** Task descriptions now get the `/` slash menu, `[[` document links, and image upload, and the task drawer widened from a fixed 400px to 75vw.

### Changed

- **Docs + agent skill refreshed** for everything since 0.13.3 — the redesigned console, the Notion editor, auto-save, annotation, rich comments, and the new file/share/artifact surface (endpoint table, MCP tool docs, `plandesk connect` skill).

## [0.16.0] — 2026-07-12

### Added

- **Rich comments with images and annotation.** The comment composer is now a full editor — leave feedback with formatting, inline images, and the same WhatsApp-style annotation overlay (arrow/box/text/blur redaction). Comment bodies are stored as HTML; existing comments keep rendering.
- **Re-editable image annotations in task descriptions.** Annotating an image inside a task description now round-trips: the annotated image is preserved as inline HTML in the Markdown body, so its arrows/boxes/text stay editable after reload (blur redaction stays permanent and safe). Task descriptions remain Markdown — the MCP/agent contract is unchanged.

## [0.15.0] — 2026-07-12

### Added

- **Image annotation in the document editor.** Insert an image, then mark it up WhatsApp-style — arrows, boxes, text labels, and blur/redact — on a custom SVG overlay. Marks flatten to a PNG so they render identically in the reader, the shared portal, and print/PDF. **Redaction is destructive and permanent**: a blurred region is baked into the stored image as a mosaic, so a redacted secret is never recoverable from the document (not even from the raw HTML) — while arrows, boxes, and text stay re-editable.

### Fixed

- **Each Plan Desk install now gets a unique random port in 3400–3499.** Port allocation scanned sequentially from 3400, so installs created while earlier servers were stopped piled onto 3400/3401 and collided — a project's `config.json` could point at a port another project's server had taken. Allocation now picks a random free, registry-unowned port; `serve` rotation on a busy port is registry-aware (it won't bind a port another live project owns); and a legacy `workspace.json` port is back-filled into `~/.plandesk/ports.json` so other installs stop treating it as free.

## [0.14.0] — 2026-07-12

### Changed

- **Redesigned web console.** The whole workspace UI was rebuilt as an operator console on shadcn/ui + Tailwind — a warm-monochrome, light-mode design system applied across Overview, Board, Flow, Goals, Documents, Notes, Inbox, settings, and the shared portal. Overview is now a real dashboard (progress, status tiles, goals, agent runs, recent documents), Documents is its own workspace tab with a **folder-based browser** (folder cards → recent → all documents), and document lists are ordered most-recently-updated first. Flow's auto-layout packs disconnected nodes into a grid instead of a single horizontal strip.
- **Every destructive action now asks first.** Deleting a project, document, note, or folder — and revoking an MCP token — routes through a confirmation dialog instead of firing on click.

### Added

- **Notion-style document editor.** Documents and notes now edit on a seamless, full-height canvas with a `/` slash menu (headings, bullet / numbered / to-do lists, quote, code block, divider, table), `[[` document-to-document links, and proper document typography (headings, lists, quotes, code, rules) that had been flattened by the CSS reset. A brand-new or empty document opens in Edit; an existing one opens read-first.
- **Auto-save for documents and notes.** The manual Save button is gone — edits persist automatically: debounced ~1s after a typing pause, forced during continuous typing, and flushed immediately on navigating away, closing the tab, or pressing ⌘S. A quiet Saved / Saving… / Unsaved indicator replaces the button, and a save never jumps the cursor mid-edit.
- **Inline comments on a selection.** Highlighting a passage in reader mode opens an in-context composer anchored to the (still-highlighted) passage; submitting posts the comment to the rail.
- **`factory` in `plandesk --help`.** The factory command is now discoverable in the default help, and `factory init` ships consumer-clean curator skills. The factory contract now commits one atomic commit per work item once its lane gate clears.

## [0.13.3] — 2026-07-09

### Fixed

- **Documents and notes with Markdown bodies no longer fail to save** — `create_document`, `update_document`, `create_note`, and `update_note` with any non-empty Markdown body previously threw `marked(): The async option was set to true by an extension` whenever the CLI and MCP server ran in one `plandesk serve` process. The CLI previewer registers an async syntax-highlighting extension on the shared `marked` singleton at load time, which broke the server-side renderer's synchronous parse. The renderer now uses its own private `marked` instance, immune to extensions registered anywhere else in the process. (#10)
- **`update_document` can now link a document to a task** — the MCP `update_document` tool silently dropped `linked_task_id` (the parameter was missing from its schema, so it was stripped before persistence). It now accepts `linked_task_id` (a task id; pass `null` to unlink) and round-trips through `get_document`. The canonical parameter for the granular document tools is `linked_task_id`; `link_to` (a task **key**) remains scaffold-only. (#11)
- **`plandesk init` no longer hands two projects the same port** — port allocation only skipped ports that were _currently listening_, so two projects whose servers were both stopped could be assigned the same port, leaving the second project's config pointed at the first project's server (401s, `binding-project-exists: no`). A machine-global registry (`~/.plandesk/ports.json`) now records each project's assigned port, and `init` skips ports owned by another project; `serve` registers the port it actually binds. Stale entries (owning project deleted) are reclaimed. (#12)
- **MCP endpoint and `doctor` failures are now legible.** The `/mcp` router is mounted before the web-UI/SPA fallback, so the MCP server→client `GET /mcp/` stream is no longer shadowed (which had broken reconnects). The MCP client now translates an HTML/non-JSON response (an SPA served on a foreign port) into an actionable error instead of an opaque `Unrecognized token '<'`. And `plandesk doctor`'s `binding-token-valid` now exercises the real authenticated MCP path — it can no longer report a token "valid" while live MCP requests are being rejected. (#13)

## [0.13.2] — 2026-07-06

### Added

- **Folder support in the previewer** — `plandesk ./dir` opens every previewable file in a folder as tabs (walked recursively). A folder of linked HTML (an RFC or exported site with relative `<img>`/`<link>`/`<a href>` to sibling files and assets) now **renders with those assets and links working**: the opened directory is served as a scoped, same-origin static root, and folder HTML is framed `sandbox="allow-same-origin"` **without** `allow-scripts` (safe for static docs) under a `default-src 'none'; img-src 'self'…; script-src 'none'; connect-src 'none'` policy. Path traversal outside the folder is blocked. Single-file previews (`plandesk file.html`) are unchanged — a lone HTML file is still treated as a self-contained, `allow-scripts`, network-dead artifact.

### Changed

- **Unified versioning** — all published packages (`@plandesk/db`, `api`, `mcp`, `cli`, `mcp-client`, `sync-server`) now share a single version, starting at **0.13.1**. Future releases bump them in lockstep. (Internal `workspace:*` deps are rewritten to the exact version on publish — no workspace references ship in the tarballs.)

### Added

- **Agent awareness of the file previewer** — the connect skill (`.plandesk/skill.md`) now tells your coding agent about the `plandesk <file.md>` previewer/annotator and how to read file annotations over MCP (`list_artifact_comments` → `resolve_comment`), closing the "you write a file → the human marks it up → you fix it" loop on files. Re-run `plandesk connect` to pick up the new skill section.

## [cli 0.13.0] — 2026-07-06

### Added

- **Rich previewer rendering** — the `plandesk <file.md>` previewer now renders fenced code with **syntax highlighting** (Shiki, dual light/dark, done at render time so the reader iframe stays script-free), **Mermaid diagrams** (`mermaid` blocks render to real diagrams), and **styled GFM tables**. Mermaid runs in the previewer's parent page and injects static SVG into the sandboxed, network-dead reader iframe — nothing executes inside the reader. The Mermaid bundle is served locally and **lazy-loaded only when a diagram is present**, so files without diagrams are unaffected.

### Changed

- **Previewer rebuilt on Hono + hono/jsx** — the local preview server now uses Hono routing and `hono/jsx` server-rendered components (matching the rest of the codebase), replacing the previous hand-rolled `node:http` server. No behavior change to the previewer's URLs, security model (sandboxed iframes + network-dead CSP), or annotation flow.

### Note

- Installing the CLI now pulls **Mermaid** as a dependency, so `@plandesk/cli` is larger on disk. It is only loaded in the browser when you preview a file containing a diagram.

## [cli 0.12.0 · mcp 0.11.0 · api 0.11.0 · db 0.9.0] — 2026-07-06

### Added

- **Artifacts + planannotator** — `plandesk <file.md>` / `plandesk <file.html>` (glob-friendly: `plandesk *.md`) opens a local browser previewer that renders agent-generated Markdown and self-contained HTML **the way a Claude artifact renders** — sandboxed and network-dead — and lets you **highlight text and attach annotations** that persist against the file. Also `plandesk open|preview|annotate <paths…>`.
  - **Rendering & isolation.** Markdown is rendered (via `marked`) inside a `sandbox="allow-same-origin"` iframe with **no** `allow-scripts` — so injected scripts can never execute (no sanitizer needed) yet the page can annotate the text. Self-contained HTML artifacts render inside `sandbox="allow-scripts"` (no same-origin) under a network-dead CSP (`connect-src 'none'`, sent as a header **and** injected as a `<meta>` that survives JS tampering). Only the files you explicitly open are served (allowlist, no traversal). Multiple files open as tabs.
  - **Annotate.** Select text → "Add note" → the note (with a W3C text-quote + position selector) is saved and listed in a side rail; resolve it, or click it to jump to the passage. Annotations **persist and re-open**: keyed by the file's path with a content hash to flag drift.
  - **Agent loop on files.** In a **connected repo**, annotations route to the workspace DB via the artifact-comments API, so your coding agent reads and resolves them over MCP — the same "you mark, the agent resolves" loop plandesk already has for documents, now pointed at any file the agent wrote. Standalone (no workspace), annotations persist to a local sidecar under `~/.plandesk/annotations/`.
- **`artifact` comment target + `anchor` column (db 0.9.0)** — the polymorphic `comments` table gains a nullable `anchor` (W3C selector JSON) and `artifact` becomes a first-class comment target. Migration `0011`; reversible.
- **Artifact-comment REST (api 0.11.0)** — project-scoped `POST`/`GET /projects/:id/artifact-comments` (the file identity travels in the body/query, so it survives slashes); `serializeComment` now emits `anchor`.
- **`add_artifact_comment` / `list_artifact_comments` MCP tools** — agents read and create file annotations. **MCP tool count is now 40** (was 38).

## [cli 0.9.1] — 2026-07-03

### Added

- **Factory policy is always-on** — `factory init` now manages a `<!-- plandesk-factory -->` include block in the repo's `CLAUDE.md`/`AGENTS.md` loading `workflow.md` + `factory.md`, so the orchestrator's program and contract ride in default context (policy gates behavior; dispatch data — protocol, workers, lanes, verifiers — stays on-demand). Idempotent; the global-dir guard still applies.
- **`workflow.md` in the factory scaffold** — the orchestrator's session program (orient → intake → execute → finish), shipped as an editable default alongside the `factory.md` per-item contract. The generated agent conventions now carry a one-line pointer ("if `.agents/factory/workflow.md` exists, follow it when executing the plan"), and the `/factory` command loads both files. Authored/create-once like all factory policy; re-run `plandesk connect` to pick up the pointer in existing repos.

## [cli 0.9.0 · mcp 0.8.0 · api 0.8.0 · db 0.6.0 · sync-server 0.5.0] — 2026-07-03

### Added

- **`plandesk factory init`** — scaffolds a project-local, harness-neutral agent factory workspace under `.agents/`: `factory.md` (the work-cycle contract), `protocol.md` (deterministic dispatch + result contract: probe → command template → result JSON whose claimed commands the engine re-runs; exit codes are authoritative), `workers/` (one file per worker CLI — claude, codex, cursor, grok, opencode — each with an availability `probe` and a `{prompt_file}` command template, so nothing assumes what is installed on a given machine), `lanes.md` (risk-lane policy), `verifiers/` (fast per-change checks, exit 0 = pass), a gitignored `runs/` zone for machine state, plus generated `/factory` command adapters for Claude Code and Codex. Authored policy files are created once and never overwritten on re-run (`skip`); adapters refresh every run. `--print` dry-runs, `--repo` targets another directory. Format rules documented in the new [Factory workspace](https://plandesk.asyncdot.com/reference/factory/) reference: one required `type` frontmatter field, identity from the file path, permissive consumers.

- **Document folders (#7)** — organize documents into nested folders: `folder` entity with cycle-safe re-parenting, documents carry an optional `folder_id`, new MCP tools `create_folder` / `update_folder`, `list_documents` returns the folder tree and filters by `folder_id`, and the documents panel renders a collapsible tree with create/rename/move (folder deletion re-homes children — nothing is orphaned). Folders round-trip through export/import.
- **Task tags (#8)** — label and filter the board: `tag` entity (name unique per project, optional color) with a task↔tag join, `create_task`/`update_task` accept `tags` (update replaces the set; unknown names auto-create), `list_tasks`/`get_next_task` filter by tags (OR semantics), new `list_tags` tool, tag chips + multi-select OR filter on the board, rename propagates everywhere, delete cascades the join. Tags round-trip through export/import.
- **MCP tool count is now 32** (was 29): + `create_folder`, `update_folder`, `list_tags`.

### Fixed

- **No more stray `workspace.db`** (#4) — commands that read a workspace (`export`, `publish`, `push`, `pull`, `share`, `token`) no longer auto-create an empty database when none exists; they fail with guidance that names the connect binding's server when one is present. Only `plandesk init` creates a workspace.
- **Unknown share token returns 404** (#4) — the sync server's `GET /shares/:token/meta` now answers 404 for a nonexistent share (was 401), matching the deploy guide's documented sanity check.
- **Deploy guide works for CLI-only installs** (#4) — explicit step-0 clone-at-matching-tag for users without a source checkout, and all remote `wrangler d1 execute` commands are non-interactive (`-y`).
- **MCP publish flow is discoverable** (#4) — `sync_push` / `publish_project` errors and descriptions now point at the CLI deploy/publish happy path.
- **Stale docs corrected** (#5) — MCP tool counts unified (the API reference was missing `get_task`/`list_tasks` entirely), and `plandesk help` no longer contradicts itself about the port default (per-project 3400–3499 vs the 3847 legacy fallback).

### Changed

- **`serve` binds `127.0.0.1` by default** (#5) — a single-user local tool must not expose its token-gated API to the whole LAN silently. LAN exposure is an explicit opt-in: `--host 0.0.0.0` or `PLANDESK_HOST`. (Reverses the 0.7.0 default.)
- **`start.md` scaffolds the factory by default** — the standard agent setup now runs `plandesk factory init` as step 5, so every connected repo gets its portable `.agents/` operating policy unless the user opts out.
- **Global-directory guard** — `plandesk connect` and `plandesk factory init` now refuse to write into your home directory or a global agent-config directory (`~/.claude`, `~/.codex`, `~/.agents`, `~/.config`, `~/.plandesk`). Agent artifacts written there (e.g. a `CLAUDE.md` include in `~/.claude`) leak into every project on the machine. `factory init --force` overrides deliberately.

## [cli 0.8.0 · mcp 0.7.0 · api 0.7.0] — 2026-06-14

### Added

- **Per-project port assignment** — `plandesk init` probes the `3400–3499` range and stores a free port in `.plandesk/workspace.json`. `plandesk serve` reads this port automatically, so each project runs on its own port without collision when multiple projects are active on the same machine.
- **Runtime port file** — `plandesk serve` writes `.plandesk/server.json` (gitignored) with the actual bound port and PID on startup, and deletes it on clean exit. PID-liveness filtering means a stale entry from a crashed process is ignored automatically.
- **`plandesk url` command** — prints the server URL for this project's `.plandesk/` dir: prefers `server.json` (live port), falls back to `workspace.json` (assigned port), then the default. `--lan` substitutes the first external IPv4 address for use in scripts or remote agents. Use `$(plandesk url)` instead of hardcoding `http://127.0.0.1:3847` in agent prompts and `start.md` scripts.
- **`get_task` MCP tool** — point read for a single task by ID. Useful for agents reconciling board state without listing everything.
- **`list_tasks` MCP tool** — lists all tasks for a project, optionally filtered by `status`. MCP tool count is now 29.

## [cli 0.7.0] — 2026-06-13

### Changed

- **Project-local database** — `plandesk init` now creates `.plandesk/workspace.db` in the current directory instead of the global `~/.plandesk/workspace.db`. Every project gets its own database, isolated from other projects on the same machine. `plandesk serve` (and `token`, `export`, `import`) walks up from cwd to find the nearest `.plandesk/` directory automatically — running `serve` from a connected repo just picks up the right database without any flags. Falls back to `~/.plandesk` only when no `.plandesk/` exists anywhere in the directory tree (backward compatible for existing global workspaces). The startup log now prints the resolved database path so it is always clear which database you are hitting.
- **Default bind host is now `0.0.0.0`** — `plandesk serve` binds to all interfaces by default, so other devices on the same local network (phone, tablet, another laptop) can reach the UI at your machine's LAN IP without any flags. Previously defaulted to `127.0.0.1` (loopback only). Override with `--host 127.0.0.1` or `PLANDESK_HOST` to restrict to loopback.
- **`PLANDESK_AUTH_PASSWORD` is now optional for non-loopback binding** — setting a password still enables HTTP auth on the UI and REST API, but it is no longer required to start the server. This removes the friction for local-network use on a trusted LAN. For internet-facing deployments (Docker, Fly, etc.) setting a password is still strongly recommended.

## [cli 0.6.0 · mcp 0.6.0 · api 0.6.0 · db 0.5.0] — 2026-06-11

### Added

- **Project notes** — free-form, project-scoped working notes with a rich-text (TipTap) editor and titles, kept separate from formal documents (notes are flat, not task-linked, and not part of the client share). New "Notes" tab per project lists notes and opens an editor/reader; create, edit, and delete from the UI. Notes are included in lossless export/import.
- **Note MCP tools** — `create_note`, `update_note`, `get_note`, and `list_notes` let agents capture and revise working notes for a project (Markdown bodies render as rich text). No `delete_note` — agents don't delete, by design. MCP tool count is now 27.
- **`notes` table** — added via migration `0005`; existing workspaces migrate automatically on `plandesk serve` (no data touched). Re-run `plandesk connect` to pick up the skill's new Notes guidance.

## [cli 0.5.0 · mcp 0.5.0 · api 0.5.0] — 2026-06-11

### Added

- **Zero-setup MCP token** — `plandesk connect` writes `.mcp.json` with a `headersHelper` that reads the gitignored `.plandesk/token` at connection time. No `export PLANDESK_MCP_TOKEN` step; the env var remains as an override.
- **Skill discovery** — `connect` symlinks the skill into `.claude/skills/plandesk/SKILL.md` and `.agents/skills/plandesk/SKILL.md` (folders created if missing); `skill.md` now carries SKILL.md frontmatter (`name`, `description`).
- **Claude command** — `connect` writes `.claude/commands/plandesk.md` so `/plandesk` works in Claude Code (alongside the existing Codex command).
- **Markdown document bodies** — MCP `create_document`, `update_document`, and `scaffold_project_from_plan` convert Markdown bodies to rich-text HTML; tool descriptions and the skill instruct agents to write well-structured Markdown.
- **Board task details** — kanban cards open a task-details panel on click (label, description, assignee, due date; close button); label editing moved from inline card editing into the panel. Drag-and-drop unchanged.
- **Legacy markdown rendering** — document editor, reader, and portal render plain-Markdown bodies (written before conversion existed) as rich text.

### Changed

- `.mcp.json` `plandesk` entry no longer uses a static `Authorization: Bearer ${PLANDESK_MCP_TOKEN}` header (which warned when the env var was unset and disabled OAuth fallback); re-run `plandesk connect` in existing repos to migrate.
- `plandesk disconnect` also removes the skill symlinks and the Claude command file.

## [1.0.0] — 2026-06-08

First production release — local-first, self-hostable planning workspace with MCP-native agent integration.

### Added

- **Canvas** — Flow view with task nodes, drag-and-drop layout, and labeled directed edges (`blocks`, `depends_on`, etc.).
- **Documents** — Markdown docs on nodes; nested tree; title prefixes and status lines; one-click from canvas node to editor.
- **Tasks & board** — Single SSOT for status across canvas badges and kanban columns; filterable task list.
- **SSE** — Live updates on `GET /api/v1/events` when tasks, canvas, docs, or agent runs change (MCP writes broadcast within 500 ms p95 on localhost).
- **MCP server** — Streamable HTTP at `/mcp/` with 10 tools: read (`list_projects`, `get_project`) and write (tasks, docs, edges, agent runs). Bearer token auth; tokens created in UI or CLI, revocable, stored hashed.
- **CLI** — `plandesk init`, `serve`, `token create`, `export`, `import`, `connect`, `disconnect`, `doctor`.
- **Repo connect** — `plandesk connect` writes `.plandesk/{config.json, skill.md, token}`, project-scoped `.mcp.json` with `${PLANDESK_MCP_TOKEN}`, CLAUDE.md sentinel block, and Codex command file.
- **Export/import** — Lossless `plandesk-export-v1` JSON (`plandesk export` / `plandesk import`).
- **Docker self-host** — `docker compose up` on port 3847; `PLANDESK_AUTH_PASSWORD` required for `0.0.0.0` bind.
- **Factory adapter** — `@plandesk/mcp-client` for programmatic MCP access from Factory Desk Plan mode.
- **Dogfood fixture** — `examples/checkout-revamp.json` sample project.
- **Validation & metrics** — `pnpm validate`, `pnpm metrics`; RFC §9 assertions and §1 targets measured in `METRICS.md`.

### Documentation

- Top-level README (quickstart, Docker, agent connect, CLI reference).
- [apps/docs](apps/docs/) — Astro Starlight documentation site (MCP setup, agent skill, CLI/API reference).
