# Plan Desk — User-Flow Audit Summary

Full four-phase audit of every user flow in the web app (`apps/plandesk-web`). Source of truth: [`plandesk-feature-audit.csv`](./plandesk-feature-audit.csv) (134 rows). Every Expected Behaviour and UX-error classification was run through the `design-reality-check` and `design-psychology` lenses.

## Counts by status

| Status | Count |
|---|---|
| `tested` (pass, no defect) | 64 |
| `retested-pass` (defect fixed + verified) | 34 |
| `error` (defect documented, deferred by scope) | 36 |
| **Total flows** | **134** |

Verification: `pnpm build` 0, `pnpm test` 0 (web 152 tests, +3 new). No regressions.

## Coverage

All 16 route areas and every route in `src/routes/` are represented, plus the shared editor / comments / share / portal surfaces. No screen was left un-exercised; UI-only interactions were verified by code-trace of the cited `path:line` where an executable test did not already exist.

| Area | Flows | Area | Flows |
|---|---|---|---|
| Documents | 24 | Comments | 7 |
| Canvas/Flow | 19 | Settings | 7 |
| Board | 18 | Overview | 6 |
| Portal | 11 | Goals | 6 |
| Inbox | 9 | Notes | 5 |
| Layout/chrome | 7 | Auth·Share·Image·Account·Home | 15 |

## Fixed this pass (34) — the "clear defects" batch

- **Systemic silent mutation failures (20 rows)** — a global `MutationCache.onError` fallback toast (`src/lib/query-client.ts`) now surfaces every previously-silent create / rename / delete / status / tag / move / org-switch / logout failure, while skipping mutations that own their error handling. One fix, 20 flows.
- **Masked query states (3)** — overview Goals + Recent-documents and the documents panel now show real loading/error states instead of collapsing to "empty".
- **3 dead/misleading controls** — sidebar workspace "switcher" (dead chevron → honest home link), Curator "Looks good" no-op (removed; note links to the Board), MCP Settings page (now has the "Connect an agent" section it promised).
- **3 missing destructive confirms** — Reject submission, Auto-layout (wipes manual positions), blur-redaction (permanent).
- **Clipboard (3)** — copy actions now catch failures (toast) and reset the "Copied" label; Share copies the human page URL, not the `.md` URL.
- **Discoverability (2)** — the editor placeholder now hints `/` for blocks and `[[` to link a doc.

## Deferred (36) — documented, product-judgment items

Left as `error` rows by explicit scope decision (they need copy/product/design calls, not bug fixes):

- **Agent-operator jargon leaking to users (8)** — lanes (`auto/approve/full`), `verification_surface`, "Release to scope", `depends_on`, the 4-char short id, the portal `→` dependency arrow, "Related task" raw-id field, CLI-only token copy.
- **Hidden/hover-only affordances (11)** — board card `…` actions, rename pencils, image "Annotate", edge-label editing, canvas tags (unreachable), note delete (edit-mode only), doc Share (edit-mode only), raw-id merge input, gate/checklist goal completion.
- **Consistency (5)** — toolbar hardcoded hex (no dark mode), duplicate "File an issue" label, task drawer has no comments rail, command-menu omits Documents, image-upload has no progress.
- **Remaining state gaps (12)** — board loading skeleton, raw error.message on board, empty-canvas guidance, keyboard node-delete, responsive doc-row metadata, portal dead-link next step, empty portal board, portal submit-403 silent hide, comment "attach selection" no-feedback, breadcrumb placeholder, sign-in methods-fetch failure.

Each carries its `error_type` (design principle) + a code-traced repro in the CSV, so they are ready to pick up as a follow-up pass.

## Unresolved `retested-fail`

None. Every fix attempted passed retest.
