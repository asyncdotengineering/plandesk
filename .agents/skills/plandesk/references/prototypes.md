# Prototypes: title resolution, network, authoring

Title resolution is what makes a copied flow wire itself to its own screens
without rewriting markup. A link built by JavaScript at runtime still
navigates but draws no line on the canvas.

### Network is dead

External scripts, stylesheets, fonts, and `fetch` are **blocked**, not
degraded — a screen that reaches for a CDN renders broken. Everything is
inline, an attached `plandesk://file/`, or a curated `plandesk://lib/`.

### Authoring skill

Flow-first conventions, mandatory unhappy paths, and the full authoring
loop live in `.agents/skills/plandesk-prototype/SKILL.md` (and its
`references/`). Read that skill when building or revising a prototype;
this section is the scheme and surface, not a second copy of those rules.
