// Curator artifacts (Plan-Desk-Curator RFC): embedded verbatim from .agents/curator/*
// in this repo, the same pattern skill-template.ts uses for the plandesk skill --
// this file is the single source of truth `factory init` scaffolds into a fresh project.

export const CURATOR_DIR = '.agents/curator';

export const CURATOR_TRIAGE_MD = `---
type: curator-skill
version: 1
---

# Curator: triage

Turns raw signal — client submissions, an ungroomed \`backlog\` column, or a
pasted brain-dump — into board-ready tasks, so the board stays true without
hand-grooming. Source-agnostic: one decision engine, three input adapters.
Zero new infra — existing MCP tools only.

**Spec:** RFC "Curator — auto-triage for Plan Desk" §4.1 + §6 · PRD stories
1-3, 18-19 · REQ-1/2/3/4. **Lane: approve** — every proposal lands as a diff
against the board; a human resolves it (the \`scope → todo\` drag is that
resolution — see [autonomy.md](autonomy.md)).

## When to run this

- Explicitly asked to "triage the backlog" / "triage submissions" / "sort
  this brain-dump".
- From [autonomy.md](autonomy.md)'s loop, or a schedule/event trigger (see
  the "Triggers" section below, built out by C4).

## Input adapters

Pick a mode, or accept an explicit one from the caller:

| mode | source | when |
| --- | --- | --- |
| \`submissions\` | \`list_submissions(project_id, status: "pending")\` | a share/team workflow is pulling client feedback |
| \`backlog\` | \`list_tasks(project_id, status: "backlog")\` | solo curation — **the default** when no mode is given |
| \`text\` | pasted raw text, one item per paragraph/line the caller marks | a brain-dump session |

Each adapter normalizes its items to \`{ id, title, body, source_ref }\` before
they reach the decision engine — \`source_ref\` is a submission ID, a task ID,
or \`"text:<n>"\` for a pasted item (no stable ID exists yet).

## Decision engine

For every normalized item, in order:

1. **Cross-check open work.** Call \`list_tasks(project_id)\` (all statuses)
   and compare the item against every existing label + description. A match
   is a duplicate if it describes the same problem/outcome, not merely a
   related area — when unsure, prefer \`accept-merge\` over creating a near-
   duplicate task.
2. **Decide exactly one outcome:**
   - \`reject\` — noise, already shipped, or out of scope for this project.
     Leave the source untouched; for a submission, do not call
     \`triage_submission\` (rejecting is a human call unless the item is
     unambiguous spam/duplicate-of-duplicate — when in doubt, prefer
     \`pending\` over \`reject\`).
   - \`accept-new\` — genuinely new work. Draft a task in house style (see
     below) and \`create_task(status: "scope", ...)\`. **Never \`status:
     "todo"\`** — the human's \`scope → todo\` release is the approval gate,
     full stop.
   - \`accept-merge\` — duplicate of an existing task. For a submission,
     call \`triage_submission({ submission_id, action: "accept", link_task_id
     })\` (this primitive ships in C3 — until then, fall back to a
     \`add_comment\` proposal on the target task naming the duplicate source,
     and leave the submission \`pending\`). For a backlog/text item with no
     submission record, add a comment to the target task noting the source
     and leave the backlog task in place with a comment pointing at the
     survivor (do not delete — there is no delete tool by design).
   - **Ambiguous or high-severity** — do not force a decision. Leave the
     source \`pending\` (or the backlog task untouched) and post a proposal
     comment describing the fork; a human decides. Never silently drop an
     item — every item gets a decision or an explicit "needs a human" note.
3. **Draft in house style** (for \`accept-new\`): imperative, outcome-focused
   label ("Verb Noun in Location"); description with **Problem** / **Action
   Items** / **References** sections (reference class/method names, never
   line numbers — see \`.plandesk/skill.md\`); assign \`tags\` for area, plus a
   \`lane\` (\`auto\` / \`approve\` / \`full\`, see \`.agents/factory/lanes.md\`) and a
   \`severity\` (\`low\` / \`medium\` / \`high\`) chosen by blast radius, both
   recorded as tags since tasks have no dedicated severity field yet.
4. **Attach provenance.** Every \`accept-new\` or \`accept-merge\` decision
   carries \`{ sources: [source_ref, ...], reason: "<why>" }\`:
   - A one-line provenance summary as the first line of the task
     description's **References** section (or appended to the existing
     task's description for a merge): \`Provenance: <decision> — <reason>
     (source: <source_ref>[, <source_ref>...])\`.
   - The full detail as a comment on the task (via \`add_comment\` on the
     task's linked document if one exists, otherwise as a project note
     referencing the task) — this is the audit trail; the description line
     is the at-a-glance. See [provenance.md](provenance.md) for the
     authoritative convention (C2).
5. **Emit a reasoning comment per decision** — even for \`reject\` and
   \`pending\` — so the drift and its fix are traceable later. Use
   \`add_comment\` on the linked document when the task has one; otherwise
   record the decision in a project note titled "Curator triage — <date>"
   and reference it from the task/submission.

## Dedup precision — start conservative

Per RFC §11: if dedup precision on real data is unacceptable, keep
\`accept-merge\` **propose-only** (a comment naming the suspected duplicate,
decision left \`pending\` for a human) rather than raising autonomy. Widen once
the metrics ledger backs it.

## Contract (for callers / the autonomy loop)

\`\`\`
triage(mode?: "submissions" | "backlog" | "text", items?: string)
  → for each normalized item:
      { decision: "reject" | "accept-new" | "accept-merge" | "pending",
        draft?: { label, description, tags, lane, severity },
        link_task_id?: string,
        provenance: { sources: string[], reason: string } }
\`\`\`

- \`status: "todo"\` is never a valid output of this skill.
- A run that touches zero items (empty backlog / no pending submissions) is
  a no-op — report "nothing to triage", do not fabricate work.

## Triggers (C4 — schedule + board events)

The Curator is only "auto" if it runs without a human opening the app. See
[automation.md](automation.md) for how this skill is wired to a schedule and
to board events (new submission, task → \`backlog\`), and for the confidence
gate that decides \`scope\` (auto) vs \`pending\` (proposal comment, no board
write) per item.

## References

RFC §4.1/§6/§11 (REQ-1/2/3/4); PRD stories 1-3, 4, 6, 18-19; note "Prior art:
owainlewis/factory" (durable-memory convergence — see
[../curator/autonomy.md](autonomy.md)); \`.plandesk/skill.md\` (house task
conventions); \`.agents/factory/lanes.md\` (lane vocabulary).
`;

export const CURATOR_PROVENANCE_MD = `---
type: curator-skill
version: 1
---

# Curator: provenance convention

The authoritative shape for "why does this task exist" — required output of
every [triage.md](triage.md) decision that isn't \`reject\`. Automated triage
is only trustworthy if every decision traces to its source (Modem's
"attributed summary points"); this is also this board's own doctrine: no
vacuous structure, observation over assertion.

**Spec:** RFC §4.1 (provenance) · PRD stories 4, 6 · REQ-4.

## What must be recorded

For every \`accept-new\`, \`accept-merge\`, or promotion decision:

\`\`\`
{ sources: string[], reason: string }
\`\`\`

- \`sources\` — the item ID(s) that led to this decision: a submission ID, a
  backlog task ID, \`"text:<n>"\` for a brain-dump line, or another task's ID
  when the decision merged one item into it. Always plural-capable — a merge
  of three duplicate reports into one task lists all three.
- \`reason\` — a one-clause, human-legible justification: *why* this became a
  task, or *why* it was merged rather than created new, or *why* it was
  promoted (e.g. severity). Not a restatement of the label.

## Dual storage (resolves RFC §12 Q2)

Both, always — they serve different readers:

1. **Description line** (at-a-glance, travels with the card): the first
   line of the task's **References** section —
   \`\`\`
   Provenance: <accept-new|accept-merge> — <reason> (source: <id>[, <id>...])
   \`\`\`
   A human scanning the board's \`scope\` column sees this without opening
   anything.
2. **Pinned detail** (the audit trail, full context): a comment via
   \`add_comment\` on the task's linked document if it has one; otherwise a
   project note titled \`Curator triage — <date>\` that lists every decision
   made in that triage run, cross-referenced from each affected task's
   description (\`See note "Curator triage — <date>" for full context.\`).
   Batch multiple decisions from the same run into one note rather than one
   note per task — it reads as a session log, not board clutter.

## Where this applies

- \`.agents/curator/triage.md\` — every \`accept-new\`/\`accept-merge\` decision,
  no exceptions; a decision missing provenance is an invalid triage output.
- \`.agents/curator/automation.md\` (C4) — scheduled/event-triggered runs carry
  the same requirement; an automated run is not exempt because a human
  wasn't watching it happen.
- Any future promotion logic (e.g. a \`backlog → scope\` auto-promotion) — the
  same \`{sources, reason}\` shape applies to promotions, not just creations.

## Non-goals

- No new schema/field — this rides on existing \`description\` + \`add_comment\`
  + \`create_note\`. Do not propose a dedicated \`provenance\` column; the board
  has no delete tool and no field additions in this phase (C3 is the only
  schema-touching task in Phase C, and it isn't this one).
- No cryptographic/immutable audit log — a human can edit a task description
  after the fact like anything else on the board; provenance is a courtesy
  to the reviewer, not a compliance ledger.

## References

RFC §4.1 (REQ-4); PRD stories 4, 6; [triage.md](triage.md) (the only current
producer of provenance); note "Prior art: owainlewis/factory" (a JOURNAL.md
is the flat-file analogue of what the pinned note achieves here, graph-native
instead).
`;

export const CURATOR_AUTOMATION_MD = `---
type: curator-skill
version: 1
---

# Curator: automation (schedule + board-event triggers)

Auto-triage is only "auto" if it runs without someone opening the app
(Modem's Automations). This wires [triage.md](triage.md) to a cadence and to
board events, with zero new infrastructure — no daemon, no webhook server,
no new Plan Desk service. Everything here composes existing pieces: the
Claude Code CLI, the \`schedule\` skill/cron, the board-as-memory hooks
([F1](hooks/)), and \`agent_runs\`/SSE the web app already streams.

**Spec:** RFC §6 · PRD stories 10, 11 · REQ-6.

## Schedule trigger

Run a headless Claude Code session on a cadence that does exactly two
things, in order: \`sync_pull\` (refresh submissions from the sync server, a
no-op if the project has no published share) then the [triage.md](triage.md)
pass over \`backlog\` (the default adapter — add \`submissions\` too if the
project has a share configured).

Set this up with the \`schedule\` skill (\`CronCreate\`) rather than building a
scheduler into Plan Desk:

\`\`\`
schedule: every 1h (adjust to backlog volume)
prompt:   "Run .agents/curator/triage.md against the current project's
           backlog and pending submissions. Follow the confidence gate
           below. Do not ask for confirmation — this is an unattended run."
\`\`\`

A cadence of 1–4 hours is a reasonable default for a solo/small-team backlog;
widen or tighten based on how much raw signal actually accumulates (there is
no metrics ledger yet to justify a specific number — this is a starting
point, not a tuned constant).

## Event triggers

There is no push-based event bus to hook into without adding new
infrastructure (a real webhook/queue is Phase X's runner territory, out of
scope here). Instead, ride the moments an agent is already looking at the
board:

- **On session start** — the F1 board-as-memory hook (see [hooks/](hooks/))
  already re-hydrates board state on \`SessionStart\`. When that hydration
  shows new items in \`backlog\` or new pending submissions since the last
  recorded progress, that is the trigger: run a triage pass before starting
  (or resuming) whatever else the session was asked to do.
- **On \`sync_pull\`** — whenever an agent or the schedule trigger above calls
  \`sync_pull\` and it reports \`pending > 0\`, immediately follow with a triage
  pass over the newly-pulled submissions. Don't leave a pull sitting
  untriaged in the same session that fetched it.
- **On a task landing in \`backlog\`** — there's no server push for this
  either; the practical trigger is the same as the schedule cadence (a
  periodic \`list_tasks(status: "backlog")\` sweep) plus the session-start
  check above. If \`agent_runs\`/SSE volume ever justifies a real push
  listener, that's a Phase X candidate (see the "Wire risk lanes to
  orchestrator waitpoints" / Trigger.dev backlog tasks) — not before.

## Confidence gate

Not every item triage touches should land in \`scope\` unattended. Before
writing anything, classify:

| severity | confidence (dedup + fit are unambiguous) | outcome |
| --- | --- | --- |
| low | high | proceed to \`scope\` per triage.md, normally |
| low | low | leave \`pending\` (submission) or untouched (backlog task) + proposal comment |
| medium/high | any | leave \`pending\`/untouched + proposal comment — a human decides, always |

"Confidence" here means: the dedup check found either a clear duplicate or
clearly nothing, AND the item maps cleanly to house-style task fields
without guessing at scope. If drafting the task required inventing details
not present in the source item, confidence is low — say so in the proposal
comment rather than fabricating specifics.

This gate is deliberately conservative on the high-severity side: per RFC
§11, if dedup/severity-judgment precision is unacceptable on real data,
widen the auto-\`scope\` band only once the metrics ledger backs it — start
narrow.

## What never changes

\`scope → todo\` stays human-only, on every trigger path, with no exception.
An unattended scheduled run has exactly the same authority as an
interactively-invoked one — automation is not a loophole for a stronger
autonomy grant (see [autonomy.md](autonomy.md)).

## References

RFC §6 (REQ-6); PRD stories 10, 11; [triage.md](triage.md) (what runs);
[provenance.md](provenance.md) (still required on every automated decision);
\`hooks/\` (F1, the session-start re-hydration this rides on); Modem
Automations (the pattern this distills); backlog tasks "Stand up self-hosted
Trigger.dev runner" / "Wire risk lanes to orchestrator waitpoints" (Phase X —
where a real push-based event bus belongs, deferred).
`;

export const CURATOR_INTAKE_MD = `---
type: curator-skill
version: 1
---

# Curator: intake (the Planner)

Turns an idea, a rough ask, or an RFC into a scaffolded Plan Desk project —
tasks, dependency edges, lanes, and a Design doc — in one \`scaffold_project_
from_plan\` call. The greenfield-planning counterpart to [triage.md](triage.md)
(existing signal) and the factory (execution): Curator / Factory / Human are
the three roles; this is the Curator's planning half.

**Spec:** RFC §4.4 · PRD story 14 · REQ-8. **Lane: approve** — a scaffolded
project lands with tasks in \`scope\`/\`todo\` per §3 below, never bypassing the
human's release gate.

Distilled from \`feature-plan\` / \`rfc-to-sprints\` / \`to-issues\` — the
methodology essence only, not a fork. Those skills target GitHub issues, RFC
files, and STATE.md wizards; this one targets \`scaffold_project_from_plan\`
and the board directly, with no file output and no multi-session wizard.

## When to run this

- "Plan X into Plan Desk" / "turn this idea into tasks" / "scaffold a project
  for Y" / handed an existing RFC or PRD and asked to put it on the board.
- Not for adding a task or two to an existing project — use \`create_task\` /
  \`create_edge\` directly (see \`.plandesk/skill.md\`). This skill is for
  standing up a **new** project or a substantial new initiative inside one.

## The method (idea → board, four moves)

### 1. Problem framing (a few sentences, not a document)

Before decomposing, state: what must change, why now, and what "done" looks
like at the project level. If the ask is already an RFC/PRD, this is a
one-paragraph restatement, not new analysis — pull the problem statement and
scope boundary straight from it. If the ask is a raw idea, ask the minimum
clarifying questions needed to frame it (see "When to ask" below) — do not
silently assume a scope boundary on a genuinely ambiguous ask.

### 2. WBS with dependency edges (the shape of the plan)

Break the problem into a work-breakdown structure: each node is a task-sized
unit of work, imperative and outcome-focused ("Verb Noun in Location" — see
\`.plandesk/skill.md\`'s task-creation conventions, which this skill inherits
verbatim). For each task, decide:

- **Dependencies** — what must land first. Express as edges (\`blocks\`,
  \`depends_on\`, \`feeds\`, \`enables\`, \`unblocks\`, \`clarifies\`, \`supports\` — the
  vocabulary in \`.plandesk/skill.md\`). A plan with no edges is a list, not a
  graph — \`get_next_task\` only sequences correctly when the edges are real.
- **Lane** (\`auto\` / \`approve\` / \`full\`, from \`.agents/factory/lanes.md\`) —
  decided by blast radius at intake, same as the factory does for execution
  work. Record it in the task description alongside Problem/Action Items/
  References, e.g. \`**Lane: full** — touches the schema.\`
- **Grouping** — related tasks get adjacent canvas positions (space ~200
  units apart per \`.plandesk/skill.md\`); a blocker sits above what it blocks.

Each task description follows house style: **Problem** (what must change,
by class/method name — never line numbers), **Action Items** (specific,
independently completable), **References** (linked docs, related tasks, and
— when scaffolding from an RFC — the RFC section it implements, e.g.
\`Spec: RFC §4.2, REQ-5\`).

### 3. Status at creation — scope vs todo

- \`scope\` — the default for anything that needs design/sizing before a human
  would hand it to an agent, or for a whole new initiative pending review.
- \`todo\` — only for tasks that are already well-enough specified to execute
  immediately AND the human driving this planning session has explicitly
  said to release them (e.g. "plan this and start on the first chunk").
  **Never invent a \`todo\`** on the strength of the plan alone — the human's
  \`scope → todo\` release is the approval gate everywhere in this project
  (see [autonomy.md](autonomy.md)), and intake does not get a special
  exemption.

### 4. Design doc (the "why", linked to the first task)

One document, title-prefixed \`Design:\`, linked to the entry-point task
(usually the first/root task in the WBS). It carries: the one-liner, why this
shape (the tradeoffs the WBS encodes), what's explicitly out of scope, and
sequencing notes ("suggested order: A → B → C"). If the source was already
an RFC/PRD, link those documents too rather than duplicating their content
into the Design doc — the Design doc is the board-native index, not a
restatement.

## The one call

Prefer \`scaffold_project_from_plan\` over building a plan with many separate
\`create_task\`/\`create_edge\`/\`create_document\` calls — it is atomic (all
tasks, edges, and documents land together or not at all) and resolves your
chosen task \`key\`s to real IDs for you:

\`\`\`
scaffold_project_from_plan({
  name, description,
  tasks: [{ key, label, description, status, x, y }, ...],
  edges: [{ from: key, to: key, label }, ...],
  documents: [{ title, body, link_to: key, status_line }, ...],
})
\`\`\`

Give every task a stable \`key\` (a slug you choose, e.g. \`c1\`, \`auth-migrate\`)
and reference those keys — not IDs — in \`edges\` and \`link_to\`; the server's
\`key_to_id\` map in the response is how you find the real IDs afterward if you
need to comment on or otherwise follow up on a specific task in the same
session.

Use the granular tools (\`create_task\`, \`create_edge\`, \`create_document\`) only
when **adding** to an already-scaffolded project — \`scaffold_project_from_
plan\` is for standing up something new.

## Decomposing a Goal into cycle-sized tasks

A **Goal** is the durable, goal-altitude contract a human hands over
(\`objective\` + \`verification_surface\` + constraints/boundaries/budget — see
the "Goal as a durable primitive" design). The human authors the Goal; **the
system owns cycle-sizing**. When asked to plan a Goal (or a worker picks up a
Goal that has no cycle-tasks yet), decompose it here so no human ever crafts a
too-big task.

Input is the Goal's \`objective\` and its \`verification_surface\` (the acceptance
that must end green). Output is a set of **cycle-sized tasks under that Goal**,
edge-sequenced, that together make the \`verification_surface\` pass.

### The sizing rule (the one rule that matters)

A task is cycle-sized when **one worker can take it start → proven-done in one
coherent pass** — one red gate made green, verified, with every changed line
tracing to that task. If you cannot describe a single checkable "done" for a
task, or it would need more than one verify-and-integrate pass, it is too big:
**split it** until each child is one cycle. Prefer more, smaller cycles over
fewer large ones — the loop (\`get_next_task\` → work → prove → done) only stays
unstuck when each step is genuinely one pass.

Each cycle-task carries its own acceptance in its **Action Items** (what makes
*this* task done), so the worker never has to guess. Sequence them with edges
(a task that needs another's output \`depends_on\` it) so \`get_next_task\`
(scoped to this Goal) walks the frontier in a runnable order.

### How to place tasks under the Goal

Use \`create_task\` with \`goal_id\` set to the Goal you are decomposing (each task
is a cycle *within* that Goal), then \`create_edge\` for the dependencies —
these are the granular "adding to an existing project" tools, not
\`scaffold_project_from_plan\` (which stands up a *new* project on the default
goal). Status is \`scope\` by default (the human's \`scope → todo\` release is the
gate here too — §3 applies unchanged; never auto-\`todo\`).

### Decompose-on-refusal (the safety net — refusal is not terminal)

If a worker in the loop hits a task that turns out too big to finish to the bar
in one pass, it does **not** bare-stop. It splits that task into cycle-sized
children (created under the same Goal via \`create_task\` with \`goal_id\`, back to
\`scope\`), records why in a comment, and lets the human release them. A too-big
task is a sizing miss to correct, never a dead end. (This mirrors the
evidence-based-completion path: a red \`verification_surface\` blocks the Goal
and files a remediation task rather than faking done — see S3.)

## When to ask vs. proceed

- Multiple reasonable WBS shapes exist → pick the one that best matches
  existing project conventions (check for a similar prior project/board on
  Plan Desk first) and say so; don't silently guess when two shapes are
  genuinely different bets, surface the fork briefly.
- The idea has no clear scope boundary (e.g. "make the app better") → ask
  before scaffolding; a WBS built on an unbounded ask produces a plan nobody
  can execute.
- Everything else — proceed. This skill is for velocity: a human should be
  able to hand over an idea and get a reviewable plan back, not a Socratic
  dialogue.

## After scaffolding

Stop. Per \`.agents/factory/workflow.md\` §2 (Intake): "assign each task a lane
at creation... then stop — humans release \`scope → todo\` on the board." Do
not immediately start executing the plan you just scaffolded unless the
human explicitly asked for that in the same request.

## References

RFC §4.4 (REQ-8); PRD story 14; \`.plandesk/skill.md\` (task/document/edge
conventions, inherited verbatim); \`.agents/factory/lanes.md\` (lane
vocabulary); \`.agents/factory/workflow.md\` §2 (the stop-after-intake rule);
distilled from \`feature-plan\`, \`rfc-to-sprints\`, \`to-issues\` (heavier,
file/GitHub-targeted skills — not forked, not depended on).
`;

export const CURATOR_AUTONOMY_MD = `---
type: curator-skill
version: 1
---

# Curator: autonomy posture (vendored, board-bound, lane-gated)

A distilled, project-local autonomy posture for driving this project's Plan
Desk board without pausing for permission on every step — bounded strictly
by the board's own lane gates. Vendored: this file has **no runtime
dependency on any global skill** (\`autonomous-stand\`, \`autonomous-manager-
stand\`, or anything under an operator's \`~/.claude\`/\`~/.agents\`). Copy it,
don't reference it.

**Spec:** RFC §4.5/§9 (REQ-9) · PRD story 17. **Lane: full** — this governs
autonomy itself; treat changes to this file with the same scrutiny as a
public contract.

## Why a distilled copy, not a dependency

The global autonomy posture (where one exists) is written for a generic
"drive any goal to done" loop, and its default — ship without pausing — would
steamroll this project's structural human gates if wedged in unmodified. A
Plan Desk project must work identically on a machine that has never seen
that global skill. This file is the whole contract; nothing here reaches
outside the project.

## The one rule everything else follows

**The board is the durable spine for what's next — not your own memory of
the plan, and not the harness's ephemeral task list.** (Harness tasks are
fine as a per-session scratchpad for the moves within one item; they just
don't survive compaction and don't decide what's next.) Every "what's next"
question is answered by calling \`get_next_task\` against the bound project —
never by recalling what you decided three turns ago. This is what makes a
long run survive compaction (see the F1 board-as-memory hooks: they re-inject
exactly this state at the forget-moments).

## The loop

\`\`\`
loop:
  task = get_next_task(project_id)          # the board decides, not you
  if task is null:
    stop — nothing actionable, report and end (or hand off to Curator triage
           if the reason is an empty backlog, not a lane block)
  if task.lane != "auto":
    stop — do not start it; see "Lane boundary" below
  work(task)                                  # do the task
  checkpoint()                                # record_agent_progress; F1's
                                               # Stop/PreCompact hooks also
                                               # persist this automatically
  update_task(task.id, status: "done")        # atomic with verification
  continue loop
\`\`\`

- One task at a time, serial — matches \`.agents/factory/factory.md\`'s own
  cycle; this posture does not introduce a second, competing execution
  model, it is how an agent runs *that* cycle unattended.
- \`record_agent_progress\` after each meaningful unit of work, not every tool
  call — same cadence as \`.plandesk/skill.md\` already specifies.

## Lane boundary — the hard stop

Consult \`.agents/factory/lanes.md\` for the task's lane before starting:

| lane | this posture's behavior |
| --- | --- |
| \`auto\` | proceed autonomously — proof + verifiers only, no pause |
| \`approve\` | do the work, post the diff-summary comment, **then stop** — never flip to \`done\`; a human resolves the comment |
| \`full\` | do the work, get an independent review (a separate agent/pass, not your own read-back), post the diff-summary + review verdict, **then stop** — never self-approve, never flip to \`done\` |

**Operational test, not a feeling:** the moment you learn a task's lane is
\`approve\` or \`full\` — whether that's before you touch it, or only discovered
mid-edit — the rule is identical: finish the smallest coherent unit of work
you're already mid-edit on (don't leave the tree in a half-written state),
verify it, post the comment, and **stop there**. "I'm already in it, might
as well keep going" past that point is exactly the collapse this table
exists to prevent — a discovered-late lane is not an excuse to finish more
than you'd have started fresh.

A task with no lane recorded is **not** \`auto\` by default — treat it as
\`approve\` until a human or the intake skill assigns one explicitly. Never
infer \`auto\` from a task merely "looking simple."

## The one thing this posture can never do

**This posture never calls \`update_task(status: "todo")\` on a \`scope\` task —
full stop, no exception.** Not when a human asks for it in the same
conversation, not when the task looks obviously ready, not as a favor, not
"on the human's behalf." The \`scope → todo\` release is specifically the
human's own action on the board (the drag in the UI) — an agent executing
that status change, even at a human's explicit request, is not the same
event and does not satisfy the gate. If a human wants a task released, the
answer is "please release it on the board" — never "sure, I'll flip it."
This is not a lane-gated behavior to loosen later; it is the single
non-negotiable line in the whole Curator system (see the RFC's "human gates
are structural" framing), and it has no "but the human told me to" carve-out.

Corollary: this posture governs *this project's own dev-task board*
identically to how [triage.md](triage.md) governs the Curator *feature's*
output — an agent operating under this posture is bound by the same rule it
is helping build.

## Anchoring across compaction

This posture assumes the F1 hook bundle is installed (\`.agents/curator/
hooks/\`, wired into the project's \`.claude/settings.json\` — see F5 for the
install step). If it is not yet installed in this project, that is a gap:
say so, and fall back to reading the board explicitly (\`get_next_task\`, the
current \`in_progress\` task, its linked document) at the start of every
resumed session rather than assuming continuity.

## When to escalate instead of proceeding

- A task's lane blocks you (\`approve\`/\`full\`) — stop and report, do not find
  a workaround (e.g. splitting the task to dodge the lane, or skipping
  straight to a "related" \`auto\` task instead — that is scope-creep dressed
  as productivity).
- \`get_next_task\` returns nothing actionable but \`scope\`/\`backlog\` has
  material sitting unreleased — that's a human-attention gap, not a bug;
  report it, do not self-release.
- A task balloons past its triaged complexity mid-work — send it back to
  \`scope\` with a comment explaining why (per \`factory.md\`'s own convention),
  don't push through with a workaround.

## References

RFC §4.5/§9 (REQ-9); PRD story 17; \`.agents/factory/lanes.md\` (lane
vocabulary, source of truth this file defers to rather than restates);
\`.agents/factory/factory.md\` (the per-task cycle this posture drives
unattended); [triage.md](triage.md) (the parallel rule for the Curator
feature's own output); F1 hooks (the anchoring mechanism referenced above);
distilled from \`autonomous-manager-stand\` (not forked, not depended on).
`;

export const CURATOR_HOOKS_SESSION_START_SH = `#!/usr/bin/env bash
# SessionStart hook — re-anchors the agent to the bound Plan Desk project's
# board state (current task, its linked doc, last recorded progress, or the
# next actionable task when idle) at the moments the thread is most likely to
# be lost: fresh startup, resume, and post-compaction.
#
# Best-effort only. A broken or slow binding must never block a session from
# starting, so every failure path below falls through to a silent, successful
# exit.
set +e

# Drain (but don't require) Claude Code's SessionStart JSON envelope on
# stdin — {"hook_event_name":"SessionStart","source":"startup|resume|compact",...}.
# Behavior here is the same for every matched source, so the payload itself
# is unused beyond being consumed.
cat >/dev/null 2>&1

context_json="$(plandesk context --json 2>/dev/null)"
if [ -z "$context_json" ]; then
  exit 0
fi

node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let context;
  try {
    context = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const lines = [];
  if (context.current_task) {
    const task = context.current_task;
    lines.push(\`Plan Desk — current task: \${task.label} (\${task.status}, id \${task.id})\`);
    if (context.linked_doc) {
      const doc = context.linked_doc;
      lines.push(\`Linked doc: \${doc.title}\${doc.status_line ? \` — \${doc.status_line}\` : ""}\`);
      if (doc.body) {
        lines.push("");
        lines.push(doc.body);
      }
    }
    if (context.last_progress) {
      lines.push("");
      lines.push(\`Last progress: \${context.last_progress.message} (\${context.last_progress.created_at})\`);
    }
  } else if (context.next_task) {
    lines.push(\`Plan Desk — no task in progress. Next actionable task: \${context.next_task.label} (id \${context.next_task.id})\`);
  } else {
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: lines.join("\\n"),
    },
  };
  process.stdout.write(JSON.stringify(output));
});
' <<< "$context_json"

exit 0
`;

export const CURATOR_HOOKS_CHECKPOINT_SH = `#!/usr/bin/env bash
# Stop / PreCompact hook — posts a best-effort progress checkpoint to the
# bound Plan Desk project's currently running agent run, so the last-known
# state survives a stop or compaction even if nothing was recorded manually.
#
# Same behavior for both events: no-op when idle (no binding, no running
# agent run). Always exits 0 — a broken checkpoint must never block Stop or
# compaction.
set +e

plandesk progress-checkpoint >/dev/null 2>&1

exit 0
`;

export const CURATOR_HOOKS_SETTINGS_SNIPPET_JSON = `{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|compact",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.agents/curator/hooks/session-start.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.agents/curator/hooks/checkpoint.sh"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.agents/curator/hooks/checkpoint.sh"
          }
        ]
      }
    ]
  }
}
`;

export const CURATOR_HOOKS_README_MD = `# Board-as-memory hooks

These scripts re-anchor a Claude Code agent to this repo's bound Plan Desk
board across the moments it's most likely to lose the thread — a fresh
session, a resumed session, and a post-compaction session — and checkpoint
progress before it's lost.

- \`session-start.sh\` — on \`SessionStart\` (startup/resume/compact), runs
  \`plandesk context --json\` and, if the bound project has a task in
  progress (or a next actionable task when idle), injects a summary of it —
  current task, its linked doc, and the last recorded agent-run progress —
  as additional context for the session.
- \`checkpoint.sh\` — on \`Stop\` and \`PreCompact\`, runs
  \`plandesk progress-checkpoint\` to post a best-effort checkpoint message to
  the project's currently running agent run.

Both scripts no-op silently (exit 0) when the repo isn't connected
(\`.plandesk/config.json\`/\`.plandesk/token\` missing) or there's nothing to
report — a broken or idle binding must never block a session start, stop, or
compaction. They assume \`plandesk\` is on \`PATH\` (install with
\`npm i -g @plandesk/cli\` or \`plandesk connect\` from an existing install).

\`plandesk factory init\` wires these in automatically — it merges the
\`settings.snippet.json\` \`hooks\` block into the project's \`.claude/settings.json\`
additively (never clobbering hooks you've configured for other events, and never
duplicating the curator entries on re-run). The snippet file is kept here for
reference and manual re-application. Hook commands are prefixed with
\`$CLAUDE_PROJECT_DIR\` so they resolve against the project root regardless of the
directory Claude Code was launched from.
`;

export type CuratorTemplate = {
  relativePath: string;
  content: string;
  executable?: boolean;
};

export const CURATOR_TEMPLATES: CuratorTemplate[] = [
  { relativePath: 'triage.md', content: CURATOR_TRIAGE_MD },
  { relativePath: 'provenance.md', content: CURATOR_PROVENANCE_MD },
  { relativePath: 'automation.md', content: CURATOR_AUTOMATION_MD },
  { relativePath: 'intake.md', content: CURATOR_INTAKE_MD },
  { relativePath: 'autonomy.md', content: CURATOR_AUTONOMY_MD },
  {
    relativePath: 'hooks/session-start.sh',
    content: CURATOR_HOOKS_SESSION_START_SH,
    executable: true,
  },
  { relativePath: 'hooks/checkpoint.sh', content: CURATOR_HOOKS_CHECKPOINT_SH, executable: true },
  { relativePath: 'hooks/settings.snippet.json', content: CURATOR_HOOKS_SETTINGS_SNIPPET_JSON },
  { relativePath: 'hooks/README.md', content: CURATOR_HOOKS_README_MD },
];

type CuratorSkill = {
  slug: string;
  name: string;
  source: string;
  description: string;
};

// The curator skills live canonically under .agents/curator/ with harness-neutral
// `type: curator-skill` frontmatter. Claude Code only auto-discovers skills under
// .claude/skills/<name>/SKILL.md carrying `name` + `description` frontmatter, so
// factory init also generates a discoverable adapter per skill.
export const CURATOR_SKILLS: CuratorSkill[] = [
  {
    slug: 'triage',
    name: 'curator-triage',
    source: CURATOR_TRIAGE_MD,
    description:
      'Turn raw signal — client submissions, an ungroomed backlog, or a pasted brain-dump — into deduped, house-style Plan Desk tasks in `scope`. Use when asked to triage the backlog or submissions, or to sort a brain-dump into tasks.',
  },
  {
    slug: 'provenance',
    name: 'curator-provenance',
    source: CURATOR_PROVENANCE_MD,
    description:
      'The provenance convention (sources + reason) every Curator triage decision must carry. Reference when recording why a task exists or was merged.',
  },
  {
    slug: 'automation',
    name: 'curator-automation',
    source: CURATOR_AUTOMATION_MD,
    description:
      'Wire the Curator triage pass to a schedule and to board events (new submission, task lands in backlog). Use when setting up automatic or unattended triage.',
  },
  {
    slug: 'intake',
    name: 'curator-intake',
    source: CURATOR_INTAKE_MD,
    description:
      'Turn an idea or an RFC into a scaffolded Plan Desk project — tasks, dependency edges, lanes, and a Design doc — in one scaffold_project_from_plan call. Use when planning a new project or a substantial new initiative onto the board.',
  },
  {
    slug: 'autonomy',
    name: 'curator-autonomy',
    source: CURATOR_AUTONOMY_MD,
    description:
      "Board-bound, lane-gated autonomy posture for driving this project's Plan Desk board unattended without breaching the human gates. Use when running the board loop autonomously.",
  },
];

function stripFrontmatter(md: string): string {
  const match = md.match(/^---\n[\s\S]*?\n---\n/);
  return match ? md.slice(match[0].length).replace(/^\n+/, '') : md;
}

// Build a Claude-Code-discoverable SKILL.md adapter from a curator source file: swap
// the harness-neutral `type` frontmatter for the `name` + `description` Claude Code
// reads to decide when to load the skill.
export function buildCuratorSkillAdapter(
  source: string,
  name: string,
  description: string,
): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${stripFrontmatter(source)}`;
}
