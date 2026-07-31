---
name: plandesk-plan-writer
description: Writes the reasoning behind a change as a Plan Desk document, in one of two forms. An RFC / design proposal for something still to be built — problem, requirements, design, alternatives, verification surface — landing as a `Design:` document. Or an ADR / architecture decision record for a call already made — context, what was chosen, who signed off, what follows — landing as a `Decision:` document. Use whenever asked to write an RFC, spec out a change, draft a design doc, write an ADR, record an architecture decision, capture why we chose X over Y, or write down a call settled in a meeting. It picks the form by asking whether anything will actually be built from it; it is the upstream of plandesk-scope-work.
user-invocable: true
argument-hint: "<feature, problem, or decision to write up>"
---

# Write the plan

Writes the reasoning behind a change, before any board exists.
**plan-writer authors the argument → [scope-work](../plandesk-scope-work/SKILL.md)
decomposes it into a board → [foreman](../plandesk-foreman/SKILL.md) builds and
proves it.**

An RFC here is a build contract that carries its own argument. Open-source RFCs
are written to win agreement and end in a comment thread; this one ends in a
decomposition and an agent that has to build from it. It needs enough argument to
be reviewable *and* enough contract to be buildable.

**Lane: approve** — a proposal, not a shipped decision. Writing it never releases
work to execution.

## When to run this

- "Write an RFC / design doc / proposal for X", "spec this out before we plan
  it", "think this through on paper first".
- "Write an ADR", "record an architecture decision", "why we chose X over Y",
  "capture what we settled in the meeting" → the
  [short form](#the-short-form--a-decision-record), not an RFC. It lands as a
  `Decision:` document on the board rather than a file in `docs/adr/`, so it is
  linkable to the tasks it governs and commentable by whoever lives with it.
- **The threshold.** An RFC earns its cost when the change is substantial or
  contended: it alters a public surface, is hard to reverse, spans several areas,
  or reasonable engineers would design it differently. A one-paragraph proposal
  is a complete RFC when the decision is small.
- **Below the threshold, hand off — never fall back to bare `create_task`.** One
  item with an obvious shape goes to
  [groom-task](../plandesk-groom-task/SKILL.md), which creates and grooms it in one
  move; a batch goes to [scope-work](../plandesk-scope-work/SKILL.md), which dedups
  first. Refusing to write an RFC and then hand-creating untriaged, ungroomed
  tasks is the worse of the two failures, because nothing downstream can tell the
  difference.
- **Not** [scope-work](../plandesk-scope-work/SKILL.md): that consumes an RFC and owns
  cycle-sizing the tasks. Already have a clear RFC? Go straight there.

## The structure

Depth scales with blast radius — the change's lane in
[lanes](../../factory/lanes.md). A small change gets the frame plus a stated check
and stops; a cross-cutting or user-facing one earns every section. Never pad a
small decision into a long document.

**Frame — always**

1. **Summary** — what changes and why, in one paragraph.
2. **Problem & motivation** — the problem, who hits it, and success stated
   concretely (the metric, behaviour, or invariant that must hold after). Keep the
   constraints separable from your solution: a motivation welded to one design
   dies with it, and a weak motivation is the most common reason an RFC is poorly
   received. Ground every "today it works like X" with a `file:line`, a commit, or
   a doc URL — an ungrounded claim is a guess wearing a fact's clothes.
3. **Non-goals** — what this explicitly will not do, and what defers to a
   follow-up. An empty list leaves the agent building from this unbounded.

**Design — always, depth by weight**

4. **Detailed design** — the bulk of the RFC. Pseudocode first (control flow and
   decisions, stripped of syntax), then the concrete surface: each public
   interface's location, signature, behaviour and error cases; config, CLI or API
   snippets as they would look; at least one worked example. Names, never line
   numbers. Concrete-over-abstract is the strongest signal of a serious RFC.
5. **Requirements (REQ-N)** — the non-negotiable behaviours, numbered, stated as
   behaviour rather than implementation. The numbers let §9 and §10 cite them, so
   nothing the RFC promised is silently dropped.

**Argue — substantial or contended changes**

6. **Alternatives** — the designs you rejected and why, plus prior art in peer
   tools. Synthesis with links, not fresh debate.
7. **Drawbacks** — why we might *not* do this: implementation cost, whether user
   space could solve it, teaching cost, integration risk, migration.
8. **Adoption & migration** — only when it changes a surface people use: breaking
   or phased, what must be sequenced, naming, how existing users learn it.

**Make it buildable — always**

9. **Decomposition sketch** — the major pieces and the order they must land in. A
   sketch, not a task list: [scope-work](../plandesk-scope-work/SKILL.md) owns
   cycle-sizing and edge-sequencing. Give it enough structure that the WBS is
   obvious.
10. **Verification surface** — each REQ-N mapped to a named test or a runnable
    command. The load-bearing section: it becomes the Goal's
    `verification_surface` and the gate the factory proves against. Write checks an
    agent can run — exit codes and named tests, not aspirations.

**Close — always**

11. **Unresolved questions** — each states a tradeoff *and* a proposed direction.
    A question with no proposal is a genuine fork for the human; surface it rather
    than guessing. Open questions with no proposal block the handoff.

**Creating a decision task records the question; it does not answer it.** This
skill does not resolve decision tasks — that is a conversation, and
[autonomy](../plandesk-autonomy/SKILL.md) already forbids an agent settling a call
that belongs to a human.

**Carry, don't re-derive.** Where earlier work already settled the framing, the
non-goals, or a rejected alternative, pull it in by reference and compact
restatement. Re-deriving is where a settled decision quietly gets re-opened.

## The short form — a decision record

**One question decides which you are writing: is anything going to be built from
this?** Yes → the RFC above. No — the call is already made, or it is about
process, tooling, a vendor, a convention → a decision record. Forcing a settled
choice through eleven sections is how it ends up not written down at all.

```markdown
Status: Decided
Type: decision
Decided by: <who drove it> · Approved: <who signed off> · Consulted: <who else>

## Context
The constraint or requirement that forced a choice.

## Decision
What was chosen, stated plainly, and how it answers the context.

## Consequences
What is now true as a result — including what this closes off, and what it
costs. The consequences someone feels later are why this document exists.
```

Title it `Decision: <the call>`. Three sections is the whole thing; wanting a
design section means the decision is not actually made and you want the RFC.
Record alternatives only when the tradeoff will come round again.

**File it in a `Decisions` folder.** `list_documents` returns the project's
folder tree — read it and reuse whatever is already there. A second `Decisions`
beside the first is worse than none, because neither is complete. Call
`create_folder` only when the project genuinely has none, then pass its
`folder_id`. That makes `list_documents(folder_id)` the "what have we decided?"
query a title prefix could never answer.

## Writing it to the board

One document via `create_document`, or a `documents` entry inside
`scaffold_project_from_plan` when authoring and scaffolding in one pass:

- **Title** — `Design:` for an RFC, `Decision:` for a decision record.
- **Metadata line near the top** — `Status:` (`Open — requires investigation`
  while drafting, `Ready for review` once the argument is complete) and a
  one-word `Type:`: *feature*, *decision*, or *informational*.
- **Body** — `##` headings, bullet lists, fenced code for pseudocode and API
  shapes. It renders as rich text; a wall of prose is unreadable.
- **Link it** to its entry-point task the moment it exists. An unlinked document
  is invisible to the plan.

Written this way it hands off cleanly: the decomposition sketch seeds scope-work's
WBS, the requirements and verification surface become the Goal's acceptance, and
each **Unresolved question** becomes a `decision` task (`kind: 'decision'`,
`status: 'scope'`), with the question as its Question and the RFC's proposed
direction as its Recommendation. The RFC has already done the work of stating the
tradeoff — the task carries it rather than restating it.

## Voice

Engineer to engineer, first-person plural, problem first, concrete over abstract,
honest about tradeoffs. The best short RFC is short on purpose.

## When to ask vs. proceed

- No clear boundary ("make it better") → ask before writing. An RFC with no scope
  is a wish, not a proposal.
- Two genuinely different design bets and the evidence favours neither → write
  both as alternatives and name the fork, rather than silently picking.
- Everything else — proceed. This turns a rough ask into a reviewable, buildable
  argument, not a Socratic dialogue.

## After writing

Stop. Do not scaffold a board or start executing off your own RFC unless the
human asked for that in the same request — `Design:` doc → human review →
[scope-work](../plandesk-scope-work/SKILL.md) is the gate. Tell them it is ready
for review; they can annotate it in the UI or with `plandesk <file>`, and you pull
their notes with `list_comments` / `list_artifact_comments` and `resolve_comment`.

## References

`.plandesk/skill.md` (document and task conventions, inherited verbatim);
[scope-work](../plandesk-scope-work/SKILL.md) (decomposes this into a board, and
carries the provenance convention this draws on);
[groom-task](../plandesk-groom-task/SKILL.md) (finishes a task the RFC left thin);
[lanes](../../factory/lanes.md) (the depth dial);
[autonomy](../plandesk-autonomy/SKILL.md) (the human-gate rule).
