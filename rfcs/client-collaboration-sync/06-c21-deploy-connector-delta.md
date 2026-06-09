# RFC Delta 06 — C21 reframed as an agent connector-spec, not a bundled provisioner

**Amends:** §2 REQ-12, §4.7 CLI surface, §8 chunk C21 (in `04-tasks-validation.md`).
**Status:** Accepted (supersedes the original imperative C21).
**Date:** 2026-06-09
**Prior art:** Flue's `flue add <name> --print | claude` connector registry (`github.com/withastro/flue`, specs at `flueframework.com/cli/connectors/<category>--<name>.md`).

---

## 1. What changes and why

The original C21 specified `packages/plandesk-cli/src/deploy.ts` as an **imperative provisioner**: TS in the CLI that detects `wrangler`/`flyctl`/`docker`, shells them, parses their output, and writes config. That shape has three structural problems:

1. **Every target is a separate code path baked into a versioned binary.** Adding Fly, or fixing a Cloudflare step Cloudflare changed, requires a `@plandesk/cli` release.
2. **The CLI carries the brittle parts** — scraping a `database_id` out of `wrangler d1 create` stdout, handling interactive auth prompts, recovering from half-applied state — which imperative code does badly and an agent does well.
3. **It ships nothing the local-first ethos wants shipped.** The local tool should not grow a cloud-provisioning engine.

The Flue pattern resolves all three: **the CLI ships no deploy logic and no artifacts; the deploy procedure is a hosted markdown spec; the coding agent is the execution engine.** This is the same shape Plan Desk already validated with `start.md` (an agent reads a hosted runbook and sets the project up in-repo).

C21 is therefore reframed: `plandesk deploy` becomes a thin **fetch-and-print of a deploy-spec registry**, and a coding agent reads the spec and runs the provisioning into the user's own repo + cloud account.

## 2. Refined REQ-12

> **REQ-12 (Portable, self-deployable server) — refined.** The hosted sync server is a single portable deployable artifact. Self-deploy MUST be **agent-assisted via a hosted deploy-spec registry**, not a bundled imperative provisioner. `plandesk deploy [target]` fetches the spec for `target` and emits it for a coding agent; the agent performs tooling detection, provisioning, schema application, token wiring, and portal publish **into the user's repo and cloud account**. The CLI MUST ship no provider-specific provisioning code and no prebuilt deploy artifacts. Adding or updating a target MUST be a registry edit, not a CLI release. Cross-org isolation MAY be satisfied by separate deployments.

## 3. Interface

### 3.1 CLI — `plandesk deploy`

```
plandesk deploy            # list available deploy guides (target, store, URL) — the index
plandesk deploy <target>   # fetch + print that guide; pipe to an agent: plandesk deploy cloudflare | claude
```

- **Location:** `packages/plandesk-cli/src/deploy.ts`.
- **No `--print`, no agent-detection.** Earlier drafts mirrored `flue add`'s env-sniffing + `--print`. Dropped as unnecessary: Flue's own mechanism is a **stdout/stderr split**, and that alone is sufficient. The spec **always** goes to **stdout**; a one-line "pipe me to your agent" tip goes to **stderr**, gated on `process.stdout.isTTY`. So `plandesk deploy cloudflare | claude` pipes a clean spec (stdout not a TTY → tip auto-suppressed), and a human running it bare sees the spec plus the tip. No flag, no fragile "am I an agent" detection.
- **Behavior:** No target → print the target index to stdout (`formatDeployIndex`). Known target → `fetch(<docsBase>/deploy/<target>.md)` (`docsBase` = `https://plandesk.asyncdot.com`, overridable via `PLANDESK_DOCS_URL` for tests/self-host) → write the body to stdout. The CLI does **no provisioning** — it fetches and prints.
- **Error cases:** unknown target → list available targets to stderr, exit 1 (no network hit); registry unreachable / non-200 → typed `DeploySpecUnavailableError` carrying the direct URL so the user can open it manually, exit 1.
- The `<docs-url> --target host` synthesize-from-docs escape hatch is **dropped** from this delta (speculative; revisit if a real unblessed-host need appears).

### 3.2 Deploy-spec registry

- **Location (source):** `apps/docs/public/deploy/<target>.md` → served at `plandesk.asyncdot.com/deploy/<target>.md` (same static-asset path as `start.md`).
- **Shape:** a self-contained, agent-runnable runbook with JSON-ish frontmatter (`target`, `store`, `website`), an idempotency note per provisioning step, a **hard secrets-handling block**, and a final verify + report-to-user block.
- **First spec shipped by this delta:** `deploy/cloudflare.md` (Workers + D1 sync-server, Pages portal) — built verbatim from the steps run by hand during the 2026-06 deploy proof.

## 4. Where the Flue analogy breaks (must be encoded, not copied naively)

Flue connectors write idempotent adapter **code**. Plan Desk deploy is **stateful, secret-bearing, and provisions billable infra** — three properties Flue's sandbox connectors lack. The registry spec MUST therefore carry guardrails Flue specs don't need:

1. **Token secrecy is load-bearing.** Deploy mints a sync token, stores its **sha256 at rest** in `sync_tokens.token_hash`, and writes the **plaintext only to gitignored `.plandesk/sync-token`** — never to stdout, logs, the DB, or a commit. The spec encodes this as a non-negotiable block (the same discipline as our delegation briefs' "Do NOT Rationalize" tables).
2. **Provisioning is non-idempotent and billable.** `wrangler d1 create` creates a paid resource; `wrangler deploy` publishes. Each provisioning step in the spec MUST instruct the agent to detect existing state (`wrangler d1 list`, existing Pages project) and reuse rather than double-create.
3. **Portal routing is orthogonal.** The portal currently resolves one sync server via a build-time `VITE_SYNC_URL`. One-portal-serves-many-deployments (dynamic token→server lookup) is a separate product decision, untouched by how deploy is packaged, and is **not** in scope for C21.

## 5. Revised chunk breakdown (replaces the single C21 row)

| ID   | Chunk                                                                                                                                                          | Files                                                                            | Grounding                | Acceptance criteria                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C21a | ✅ **Shipped:** `plandesk deploy` thin fetch + print (no provisioning, no `--print`/detection)                                                                 | `packages/plandesk-cli/src/deploy.ts` (+`deploy.test.ts`), `args.ts`, `cli.ts`   | REQ-12                   | no target → index to stdout; known target → spec to stdout (+ isTTY pipe-tip to stderr); unknown target → stderr + exit 1 (no network); registry error → `DeploySpecUnavailableError` + direct URL                                               |
| C21b | ✅ **Shipped:** `deploy/cloudflare.md` registry spec (Workers + D1 + Pages), built from the by-hand deploy, Flue voice, context7-grounded wrangler/D1 commands | `apps/docs/public/deploy/cloudflare.md`                                          | REQ-12                   | Following only the spec from a clean checkout + a Cloudflare account reaches a live sync-server URL + a working portal link                                                                                                                      |
| C21c | ✅ **Shipped:** portal SPA fallback in source                                                                                                                  | `apps/plandesk-web/public/_redirects`                                            | REQ-12, A-UI-portal-read | `pnpm --filter plandesk-web build` emits `dist/_redirects` (verified); deep-linking `/p/:token` on Pages serves the app                                                                                                                          |
| C21d | ✅ **Satisfied:** token-secrecy guardrail                                                                                                                      | `deploy/cloudflare.md` (secrets block + mint one-liner)                          | REQ-12                   | The mint one-liner writes plaintext only to gitignored `.plandesk/sync-token` and emits only `id + hash` — plaintext never reaches stdout/D1/git. (No separate CLI code; the share-token's sha256-at-rest is unit-tested in `sync-cli.test.ts`.) |
| C21e | ✅ **Shipped:** `plandesk share create` — CLI transport for the existing `ShareService.createShare`                                                            | `packages/plandesk-cli/src/{share,args,cli}.ts`, `sync.ts` (+`sync-cli.test.ts`) | REQ-12, REQ-15           | `plandesk share create --audience "X" [--public] [--invite a@b,c@d] [--allow-submit] [--expires 30d]` prints a `plandesk_share_…` token + the `<portal>/p/<token>` link; defaults `read:true, submit:false`; only the sha256 hash is persisted   |

> **C21e shipped (2026-06-09).** Discovered building `cloudflare.md`: share creation was a built, supported service (`ShareService.createShare`, with `DEFAULT_PERMISSIONS`/`DEFAULT_POLICY`) with **no CLI/MCP/HTTP transport** — `plandesk share create` was listed in §4.7 but unimplemented, the one gap blocking a clickable link end-to-end. Now built: `share.ts` (`runShareCreate` + `--expires` duration parsing + comma-split `--invite` + `--allow-submit`), wired through `args.ts`/`cli.ts`, with a `resolveProjectId` helper in `sync.ts` and four `sync-cli.test.ts` cases (mint+hash-at-rest, missing-audience, bad-expires, pushable). `cloudflare.md` Step 7 now uses the real command.
>
> `deploy/fly.md` and `deploy/docker.md` are follow-on registry files (one file each, no CLI change) and remain backlog, not part of this delta.

## 6. Validation contract additions

| ID                  | Source       | Assertion                                                                                                                                      |
| ------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-12              | §2 (refined) | `plandesk deploy --print` emits the registry spec; the CLI contains zero provider provisioning code                                            |
| test:deploy_print   | §9.1         | `deploy cloudflare --print` returns the `cloudflare.md` body; non-TTY auto-prints; unknown target errors with the target list                  |
| A-deploy-cloudflare | §9 (manual)  | Following only `deploy/cloudflare.md` from a clean checkout yields a live worker URL + a portal link that renders a pushed projection          |
| A-deploy-secrecy    | §9 (manual)  | Across the full `cloudflare.md` run, the plaintext sync token appears only in `.plandesk/sync-token` (gitignored); never in stdout, D1, or git |
