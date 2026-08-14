---
title: Prototypes
description: Click-through HTML screens an agent builds and a human comments on, before anyone writes the real thing.
---

A **prototype** is a named flow of **screens** with one declared viewport. Screens are
HTML artifacts, laid out on a canvas, wired to each other by links, and open for comment.
An agent writes them; you click through the flow and mark up what is wrong.

The point is to argue about a screen before it costs a sprint to change.

## The shape

A project can hold many prototypes. A screen is an `html` artifact carrying a
`prototype_id` — that nullable column is the only line between a stored report and a
screen in a flow.

```jsonc
create_prototype({ project_id, name: "Checkout", viewport_width: 390, viewport_height: 844 })
create_artifact({ project_id, title: "Checkout — Cart", kind: "html", content, prototype_id })
```

Viewport presets are guidance, not an enum — 390×844 phone, 1024×768 tablet, 1440×900
desktop. Any positive size is accepted.

**Never send `x`/`y`.** Layout is system-owned: the canvas positions screens from the link
graph, so the arrangement follows the flow instead of drifting from it.

`create_prototype` also creates a folder and a flow document edged to the prototype, so
the reasoning has somewhere to live next to the screens.

## Authoring from a file

Inline `content` means re-sending the whole document on every revision. Prefer pushing
from a file:

```bash
plandesk report.html                                  # preview locally first
plandesk push-artifact checkout-cart.html --prototype Checkout
```

`push-artifact` stamps the file with a `<!-- plandesk-artifact:<id> -->` sentinel, so the
next push updates the same screen instead of creating a second one.

## The `plandesk://` scheme

Screens link to each other, to attached files, and to curated libraries through one
scheme.

| Form                              | Resolution                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `plandesk://artifact/<uuid>`      | Pin to exactly this screen.                                                                  |
| `plandesk://artifact/<title>`     | Case-insensitive title match — this prototype first, then project-wide.                      |
| `plandesk://file/<uuid>`          | An attached project file (images). Use this instead of inlining base64.                      |
| `plandesk://lib/<name>@<version>` | A curated library from the manifest. Anything outside the manifest is refused at write time. |

Title resolution is what lets a copied flow wire itself to its own screens without
rewriting any markup. Resolution never guesses: zero matches or several matches in scope
both resolve to nothing, and the link renders visibly broken on the canvas rather than
silently pointing somewhere wrong.

A link built by JavaScript at runtime still navigates, but the canvas cannot see it, so it
draws no line.

## The network is dead, not slow

A screen renders under a strict Content-Security-Policy:

```
sandbox allow-scripts; default-src 'none'; img-src data: blob: <origin>;
style-src 'unsafe-inline'; script-src 'unsafe-inline' <origin>;
font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'
```

External scripts, stylesheets, fonts, and `fetch` are **blocked**, not degraded. A screen
that reaches for a CDN renders broken. Everything must be inline, an attached
`plandesk://file/`, or a curated `plandesk://lib/`.

### Curated libraries

Libraries ship as content-addressed files with a recorded SHA-256, so rendering never
fetches from the network — the `sourceUrl` in the manifest is provenance only.

| Library    | Version | License |
| ---------- | ------- | ------- |
| `mermaid`  | 11.16.0 | MIT     |
| `chart.js` | 4.5.1   | MIT     |

## Moving screens between flows

| Tool          | Behaviour                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `move_screen` | Keeps the artifact id and its comments; re-resolves derived links in the destination. Markup is not rewritten.     |
| `copy_screen` | Produces a **new** artifact with the same content. Comments do not travel. Title links resolve in the destination. |

Both are also available on the canvas as the **Move / Copy** control on a screen.

## Review

Open a prototype in **Comment** mode, select a region, and leave a note. Comments attach to
the screen artifact, so the agent pulls them with `list_artifact_comments`, revises the
same `artifact_id`, and calls `resolve_comment` — the same produce → annotate → revise loop
artifacts use everywhere else.

Share a flow with someone who has no MCP access using `create_share_link` with a
`prototype_id`.

## Authoring conventions

Flow-first conventions, mandatory unhappy paths, and the full authoring loop live in the
`plandesk-prototype` skill, installed by `plandesk factory init`. This page documents the
surface and its rules; the skill teaches an agent how to use them well.

## Related

- [The Skill](/connecting-agents/skill/) — the conventions an agent follows
- [REST + MCP API](/reference/api/) — every prototype tool
- [CLI reference](/reference/cli/) — `push-artifact` and the file previewer
