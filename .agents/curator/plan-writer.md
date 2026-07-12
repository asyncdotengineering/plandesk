---
type: curator-skill
version: 1
---

# Curator: plan-writer (the RFC author)

Writes an RFC as a Plan Desk `Design:` document — the reasoned proposal for a
substantial change, written *before* any board exists. It is the upstream of
[intake.md](intake.md): **plan-writer authors the RFC → intake decomposes it into
a board → the factory executes and proves it.** Curator authors and plans;
Factory builds; Human decides. This skill is the Curator's authoring half.

An RFC here is **a build contract that carries its own argument.** The house
styles of mature open-source projects (Sentry, Ember, React, the Vercel / AI SDK
ecosystem) write RFCs to win *agreement* — the "should we / why / what else"
debate is the body. A Plan Desk RFC does that too, but its downstream is not a
comment thread: it is intake (which decomposes it) and an agent factory (which
builds and proves it). So it must also be *executable without guessing* — named
requirements, a concrete design, and a stated way to check success. Carry enough
argument to be reviewable, and enough contract to be buildable.

**Lane: approve** — an RFC is a proposal, not a shipped decision. It lands as a
document a human reads and steers before intake turns it into `scope`/`todo`
tasks. Writing the RFC never releases work to execution.

## When to run this

- "Write an RFC / a design doc / a proposal for X", "spec this out before we
  plan it", "think this through on paper first", handed a rough idea and asked to
  reason it out rather than immediately decompose it.
- **The RFC threshold.** An RFC earns its cost when the change is *substantial or
  contended*: it alters a public surface, is hard to reverse, spans several areas,
  or reasonable engineers would design it differently. For a task or two with an
  obvious shape, skip the RFC — `create_task` directly (see `.plandesk/skill.md`).
  Ceremony that outweighs the decision is the failure mode; a one-paragraph
  proposal is a complete RFC when the decision is small.
- **Not** the same as [intake.md](intake.md): intake *consumes* an RFC (or a raw
  idea) to build the board and owns cycle-sizing the tasks. If you already have a
  clear RFC and just need it on the board, go straight to intake. Plan-writer's
  job ends at a reviewable, buildable document — it does not size tasks.

## The instincts every good RFC shares

Write to these, not to a rigid template:

- **Problem before solution.** Open by making the reader feel the problem. State
  the constraints you are solving *without* coupling them to your chosen design —
  a well-argued motivation outlives the specific solution and seeds the
  alternatives if the first design is rejected. A weak motivation is the most
  common reason an RFC is poorly received.
- **Ground every claim.** "Currently works like X" needs a `file:line`, a commit,
  or a doc URL; "the framework does Z" needs a primary source. An ungrounded
  factual claim is a guess wearing a fact's clothes — cite at the point of use.
- **Carry, don't re-derive.** When earlier work already settled the framing, the
  non-goals, or a rejected alternative (a prior investigation, a triaged signal,
  a decision recorded under [provenance.md](provenance.md)), pull it in by
  reference and compact restatement — re-deriving it is where a settled decision
  quietly gets re-opened at the handoff.
- **Show the shape, concretely.** The design is the bulk of the RFC. Make it real:
  pseudocode for the algorithm, then the proposed signatures, a config or CLI
  snippet as it would look, module and type names (never line numbers), and at
  least one worked example. Concrete-over-abstract is the strongest signal of a
  serious RFC.
- **Argue the other side, then say how you'll know.** Name drawbacks and
  alternatives honestly (propose one, list the rejected with *why*). Then state
  the acceptance that must end green — an RFC that cannot say how success is
  checked is not ready to plan.
- **Scale ceremony to weight.** Match depth to the change's blast radius (its lane
  in [lanes.md](lanes.md)): a small change gets the frame + a stated check and
  stops; a cross-cutting or user-facing one earns every section. Never pad a small
  decision into a long document.

## The structure — frame, design, argue, make buildable, close

**Frame (always):**

1. **Summary** — one paragraph: what changes and why, in a breath.
2. **Problem & motivation** — the problem, who hits it, and success stated
   concretely (the metric, behavior, or invariant that must hold after). Keep the
   constraints separable from the solution. Ground the "today it works like X"
   claims.
3. **Non-goals / out of scope** — what this explicitly will *not* do, and what is
   deferred to a follow-up. This fences the executor: an empty list leaves the
   agent that builds from the RFC unbounded.

**Design (always; depth by weight):**

4. **Detailed design** — the proposed shape. Pseudocode first (control flow and
   decisions, stripped of syntax), then the concrete surface: for each public
   interface, its location, signature, behavior, and error cases; config/CLI/API
   snippets as they would look; a worked example.
5. **Requirements (REQ-N)** — the non-negotiable behaviors, numbered, stated as
   behavior not implementation. Numbering lets the work items and the checks below
   cite them (REQ-1, REQ-2, …), so nothing the RFC promised gets silently dropped.

**Argue (substantial or contended changes):**

6. **Alternatives** — the designs you rejected and why; prior art in peer tools.
   Synthesis with links, not fresh debate.
7. **Drawbacks** — why we might *not* do this: implementation cost, whether it is
   doable in user space, teaching cost, integration risk, migration /
   breaking-change cost.
8. **Adoption, migration & teaching** — only when it changes a surface people use:
   is it a breaking change, is there a phased path, what has to be sequenced; plus
   naming/terminology and how both new and existing users learn it.

**Make it buildable (always — this is what feeds intake and the factory):**

9. **Decomposition sketch** — the rough shape of the work: the major pieces and
   the order they must land in. Keep it a *sketch*, not a task list —
   [intake.md](intake.md) owns cycle-sizing and edge-sequencing the real tasks.
   Your job is to give intake enough structure that its WBS is obvious.
10. **Verification surface** — how we'll know it worked: the acceptance that must
    end green, tied back to the requirements (each REQ-N → a named test or a
    runnable command). This is not decoration — it becomes the
    `verification_surface` of the Goal intake decomposes, and the gate the factory
    proves against. Every requirement should trace to at least one check here.

**Close (always):**

11. **Unresolved questions** — each states a tradeoff and a *proposed* direction.
    A question with no proposal is a genuine fork for the human; surface it rather
    than guessing. Open questions with no proposal block the handoff to intake.

## Two Plan-Desk-native moves

- **Decision RFCs record the call.** When the RFC exists to settle a contended
  choice rather than introduce a feature, name who drove it, who approves, and who
  was consulted, and record the chosen option with its rationale — so the board
  keeps *why* this path was taken, not only that it was.
- **The verification surface is the bridge.** Section 10 is the single most
  load-bearing part for the factory: it is literally the Goal's acceptance. Write
  it as checks an agent can run (exit codes, named tests), not aspirations.

## The output — a Design document on the board

Write the RFC as one Plan Desk document via `create_document` (or as a
`documents` entry inside `scaffold_project_from_plan` when authoring and
scaffolding in one pass):

- **Title** prefixed `Design:` (the RFC-equivalent prefix — see
  `.plandesk/skill.md`'s document conventions, inherited verbatim).
- **A metadata line near the top:** `Status:` (`Open — requires investigation`
  while drafting, `Ready for review` once the argument is complete) and a
  one-word `Type:` — *feature*, *decision*, or *informational*.
- **Body as well-structured Markdown** — `##` headings for the sections above,
  bullet lists, fenced code for the pseudocode/API/config shapes, blank lines
  between paragraphs. Bodies render as rich text; a wall of prose is unreadable.
- **Link it** to its entry-point task with `link_to` (or `create_document`'s link)
  the moment it exists — an unlinked document is invisible to the plan.

Written this way the RFC hands off cleanly: the decomposition sketch seeds
intake's WBS, the requirements and verification surface become the Goal's
acceptance, and the unresolved questions become `scope` tasks.

## Voice

Engineer-to-engineer and first-person-plural ("we want to make X reliable"),
problem-first, concrete over abstract, honest about tradeoffs. No marketing
language, no emoji, no ceremony for its own sake. Match the length to the
decision: the best short RFC is short on purpose, and the best long one earns
every section.

## When to ask vs. proceed

- The problem has no clear boundary ("make it better") → ask before writing; an
  RFC with no scope is a wish, not a proposal.
- Two genuinely different design bets exist and the evidence does not favor one →
  write *both* as alternatives and name the fork for the human rather than
  silently picking.
- Everything else — proceed. This skill turns a rough ask into a reviewable,
  buildable argument, not a Socratic dialogue.

## After writing

Stop. The RFC is a proposal for a human to read. Do **not** scaffold a board or
start executing off your own RFC unless the human asked for that in the same
request — the `Design:` doc → human review → [intake.md](intake.md) handoff is
the gate. Tell the human the RFC is ready for review (they can annotate it in the
UI, or open the file with `plandesk <file>`; pull their notes with
`list_comments` / `list_artifact_comments` and `resolve_comment`).

## References

`.plandesk/skill.md` (document/task conventions, inherited verbatim);
[intake.md](intake.md) (the downstream skill that decomposes the RFC into a board);
[provenance.md](provenance.md) (the evidence convention motivation draws on);
[lanes.md](lanes.md) (the depth dial); [triage.md](triage.md) and
[autonomy.md](autonomy.md) (the sibling Curator roles).
