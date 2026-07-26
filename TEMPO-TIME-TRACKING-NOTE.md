# Note → consider folding **Tempo** (time tracking) into Plan Desk

**Left by:** Mithushan (via Claude), 2026-07-22
**For:** the next Plan Desk / Factory session
**Status:** idea to evaluate — not yet a node on the board. If it holds up, turn it into stories.

---

## Why this note exists

Plan Desk runs the **Factory**: a board where AI agents do the work and return reviewable PRs,
with a supervisor orchestrating IC workers. What the board can't yet answer is the question every
client and every retro eventually asks: **how much work went into this?** — split into

- **agent hours** — time/effort the Factory's agents spent on a work item, and
- **manual hours** — the human work around it (design, review, integration, the parts a person did).

I just built a small, self-contained time tracker — **Tempo** — that already solves the hard,
boring 80% of this (schema, import, backdating, reports, export, auth, live timer). Rather than
build tracking from scratch inside Plan Desk, **consider folding Tempo in** as Plan Desk's
time-tracking capability, so every project/board can report agent + manual hours per story.

## Where Tempo is

- **Code:** `/Users/mithushancj/Documents/personal/tempo/`
- **Repo (private):** https://github.com/octalpixel/tempo
- **Live:** https://tempo.mithushancj.workers.dev
- **Spec:** `tempo/rfcs/rfc-001-tempo-phase1.md` — read this first; it has the data model and the
  import contract.
- **Stack:** TanStack Start (React) on Cloudflare Workers · D1 + Drizzle · better-auth · pnpm.
  Same self-hostable, local-first-friendly shape as Plan Desk (CF Workers/D1 vs Plan Desk's SQLite).

### What Tempo already gives you
- Data model with **caller-settable `startAt` and `createdAt`** — i.e. entries can be **backdated**,
  which is exactly what you need when logging work *after* an agent run finished.
- **Import** of a timesheet CSV (create-or-links project/task, backdates `createdAt = startAt`).
- **Live timer** + manual entry grid — the manual-hours side, done.
- **Reports** (group by project/task/tag, hours + amount) and **export** (CSV/XLSX/print-PDF).
- A **project-scoped skill** at `tempo/.claude/skills/git-timesheet/` that reconstructs an
  hour-by-hour timesheet **from git commits** — see the next section, it's the key bridge.

## The interesting problem to research: translating **agent hours → working hours**

This is the part worth actually researching before building — please dig in and write up findings.

An agent doesn't work like a person. A Factory run might take **8 minutes of wall-clock over 40
turns and 300k tokens** to produce a diff a human would have taken **half a day** to write. So
"agent hours" has at least three candidate meanings, and they give very different numbers:

1. **Raw runtime** — wall-clock the agent was active. Cheap to measure, but understates the value
   (agents are fast) and is useless for client-facing estimates.
2. **Consumption** — turns / tokens / tool-calls. A proxy for effort, but not legible to a client.
3. **Equivalent human working-hours** — "what would this have cost a person?" This is the number a
   client, an estimate, or a retro actually wants — and it's the one to solve.

**Research questions to answer:**
- What's a defensible way to convert an agent run into **equivalent human working-hours**? Is it a
  fixed multiplier, a complexity-weighted estimate, or reconstructed from the *artifacts* the run
  produced (diff size, files touched, stories closed)?
- **Reuse the git-timesheet method.** Tempo's `git-timesheet` skill already reconstructs
  working-hours from *human* commits (anchored to real commit dates, spread realistically,
  reconciled to a target total). The Factory produces **agent** commits/PRs — so the *same*
  reconstruction could translate agent-authored commits into equivalent working-hours. Evaluate
  whether that's the cleanest bridge: agent output → git-timesheet → hours → Tempo entry (tagged
  `agent`), sitting next to `manual`-tagged human entries on the same project.
- How do you keep it **honest**? (The git-timesheet skill has an honesty contract — hours reflect
  real work, never inflated. Agent-hour translation needs the same discipline, or it becomes a
  fiction.)

## Consider the **storyboard method**

Plan Desk is already story/board-native — lean into it. Instead of trying to time agents by the
clock, **attribute hours to stories**:

- Each board story/node carries an **estimate** (points or hours).
- When a story is closed — by an agent run, by a human, or both — the estimate (not raw runtime)
  becomes the tracked hours, split into an **agent share** and a **manual share**.
- Agent hours then roll up from *stories delivered*, not from stopwatch time — which sidesteps the
  "8 minutes vs half a day" problem entirely and stays legible to a client.
- Research whether story-point → hours calibration (velocity, historical actuals) gives a stable
  enough conversion to trust, and how it composes with the git-reconstruction approach above
  (artifacts to cross-check the estimate).

## Suggested shape of the work (if it survives evaluation)

1. **Research spike** — write up the agent-hours → working-hours translation options + a
   recommendation (storyboard vs reconstruction vs hybrid). Output an ADR / note.
2. **Decide the fold-in** — Tempo as a Plan Desk package/app vs a linked service; reuse its schema
   (`startAt`/`createdAt` backdating is the load-bearing bit) and its `git-timesheet` skill.
3. **Model** — every time entry tagged `agent` or `manual`, linked to a board story; reports split
   the two.
4. **Wire the Factory** — on run completion, translate the run into an `agent`-tagged, backdated
   entry against its story (via the chosen method).

Not urgent, and nothing here is decided — evaluate it, push back if the fold-in is the wrong call,
and if it's right, put it on the board as stories. Start from `tempo/rfcs/rfc-001-tempo-phase1.md`
and `tempo/.claude/skills/git-timesheet/SKILL.md`.
