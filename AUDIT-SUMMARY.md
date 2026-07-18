# Plan Desk — User-Flow Audit Summary

Full four-phase audit of every user flow in the web app (`apps/plandesk-web`). Source of truth: [`plandesk-feature-audit.csv`](./plandesk-feature-audit.csv) (134 rows). Every Expected Behaviour and UX-error classification was run through the `design-reality-check` and `design-psychology` lenses.

## Counts by status

| Status | Count |
|---|---|
| `tested` (pass, no defect) | 64 |
| `retested-pass` (defect fixed + verified) | 70 |
| `error` (unresolved) | 0 |
| **Total flows** | **134** |

**All 70 defects are fixed.** The first pass shipped 34 "clear defects" (beta.6); the second pass (beta.7) cleared the remaining 36 — jargon → plain language, hidden affordances made reachable, dark-mode theming, and every missing empty/loading/error state. Verification: `pnpm build` 0, `pnpm test` 0 (web 155 tests, +6 over baseline). No regressions.

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

## Second pass (36) — now fixed (beta.7)

- **Jargon → plain language** — lane gate tooltip + in-drawer selector, short-id tooltip, an editable edge-relationship picker with friendly labels, "Send to planning", portal dependencies as plain sentences, a task-label picker for the guest "related part", friendlier no-GitHub copy, board-load Retry.
- **Hidden affordances made reachable** — card actions / rename pencil / annotate now touch- and keyboard-reachable, Share + note-Delete exposed in Reader mode, canvas tags wired, merge uses a task picker, gate/checklist goals show a "handled by the runner" note.
- **Consistency + theming** — toolbar switched to design tokens (dark-mode), upload indicator, de-duplicated "File an issue" label, Documents added to the command menu, **the board task drawer now has a comments rail**.
- **State gaps** — board skeleton, empty-canvas/empty-portal hints, dead-link next step, breadcrumb placeholder, Approve loading label, sign-in methods-fetch fallback, guest submit-403 message (form stays visible), image-upload base64-fallback warning, attach-selection hint, keyboard node-delete, responsive doc-row metadata, and a persistent inline error on share-create.

## Unresolved `retested-fail`

None. Every fix attempted passed retest.
