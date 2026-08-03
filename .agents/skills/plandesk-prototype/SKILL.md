---
name: plandesk-prototype
description: Author Plan Desk click-through HTML prototype screens. Use when building or revising a prototype flow, writing a screen as an HTML artifact, linking screens with plandesk://artifact/…, attaching images, or using plandesk://lib/… libraries. Self-contained — does not invoke other skills.
---

# Plan Desk prototypes

A prototype is **interactive but deliberately not functional**. Stub the data,
fake the state, demonstrate the transition. The point is a conversation about
what should happen in the flow — not a working product. (Mintlify: prototypes
are "not actually functional, but… a great way… to have a conversation on what
we expect to happen.")

This skill is self-contained. Do **not** invoke other skills by name; the load-
bearing design rules are inlined below (sources cited, not called).

## 1. Purpose before mechanics

Write for the person who will walk the flow and leave comments. Show the
decision, the empty state, the error — not a polished happy path that hides the
problems the prototype exists to find.

## 2. Flow before screens

Before authoring HTML:

1. Open (or create) the prototype's linked **flow document**
   (`Design: <name> flow`).
2. List the screens, the transitions between them, and the **states each must
   show** (empty, loading, error, permission-denied, long-content, edge input).
3. Only then write screens. A canvas of five happy-path screens does not say
   whether a sixth is missing.

Unhappy paths are **mandatory**, not optional. At least one non-happy state
must appear in the first draft without being asked for.

## 3. Authoring loop

```
# draft under a gitignored working copy (DB is source of truth)
plandesk <screen.html>                 # local preview
plandesk push-artifact screen.html --prototype Checkout
plandesk attach shot.png               # → URL; reference it, never base64
```

- Screens are `html` artifacts with a `prototype_id`.
- Prefer `file_path` / CLI push over pasting megabytes of HTML into a tool call.
- After a human annotates, pull with `list_artifact_comments`, revise, push.

## 4. Navigation and what renders broken

| Write                               | Meaning                                               |
| ----------------------------------- | ----------------------------------------------------- |
| `plandesk://artifact/<id-or-title>` | Navigate to another screen (case-insensitive title).  |
| `plandesk://lib/<name>@<version>`   | Curated library — see `references/libraries.md`.      |
| `plandesk://file/<id>`              | Attached file (images).                               |
| `https://…` / CDN / remote script   | **Forbidden** — refused at write, blocked at runtime. |

A link to a missing artifact renders **visibly broken** and creates no edge.
That is information, not a bug to paper over.

## 5. Forbidden

Models reach for these by reflex — do not:

- React, Vue, Svelte, or any SPA framework
- `axios`, `fetch` to remote hosts, WebSockets
- CDNs (`unpkg`, `jsdelivr`, Google Fonts, Remix Icon CDN, …)
- `localStorage` / `sessionStorage` / cookies (opaque origin — unavailable)
- Arbitrary Tailwind-style bracket values from a framework you cannot load
- Inlining screenshots as base64 in `artifacts.content` — `attach` / `attach_file` and reference the URL
- Invoking another skill by name or via the Skill tool — this skill is self-contained

## 6. Available libraries

See [references/libraries.md](references/libraries.md) — generated from the
manifest. Only those `plandesk://lib/…` refs work.

## 7. Design rules (distilled)

Inline so this skill works on machines that lack the source skills.

1. **You are not the user** — what is obvious to you is not obvious on first
   look. Design the struggler's path. _(design-reality-check)_
2. **Watch behavior, not words** — show what people do in the flow; do not
   trust a caption that says they would. _(design-reality-check / psychology)_
3. **First session must pay** — the opening screen earns the next click;
   bury the cost, surface the reward. _(design-psychology / present bias)_
4. **Cut load; curate choices** — one primary action per screen; recognition
   over recall; strong defaults. _(design-psychology / Hick, Miller)_
5. **Touch targets and thumb reach** — primary controls ≥ 44pt; keep critical
   actions in easy reach on a phone viewport. _(ux-strict-mobile / Fitts, HIG)_
6. **Empty, error, and permission states are screens** — not afterthoughts.
   Prescribe them in the flow doc before building. _(ux-pattern-composer)_
7. **No emoji decoration; no purple-glow AI defaults** — pick a clear visual
   direction; prefer real product imagery over abstract gradients.
   _(design-taste-frontend)_
8. **Match mental models for plumbing** — links look like links; buttons look
   like buttons; do not invent novel chrome for navigation.
   _(design-psychology / Jakob)_

## 8. Sandbox facts (opaque origin)

- CSP: scripts run; network is dead (`connect-src 'none'`).
- No `allow-same-origin` — no storage, no parent DOM access.
- Images: `data:`, `blob:`, or this server's `/api/v1/files/…` via
  `plandesk://file/…` rewrite — never a third-party host.
- Forms and top-level navigation out of the frame are blocked.

## 9. Done check

A two-screen flow that: renders under the artifact CSP, navigates via
`plandesk://artifact/…`, draws its link on the canvas, includes at least one
non-happy state, and references libraries only from the manifest — without
invoking any other skill.
