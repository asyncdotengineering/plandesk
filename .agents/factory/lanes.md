---
type: lanes
---

# Risk lanes

Every work item gets a lane at intake, decided by blast radius. Gates are
loosened per lane only when the metrics ledger justifies it — cite the
evidence when you loosen one.

| lane    | applies to                                      | gate                                                  |
| ------- | ----------------------------------------------- | ----------------------------------------------------- |
| auto    | isolated, low-blast-radius changes (copy, docs) | proof + verifiers only — no human                     |
| approve | routine feature work                            | diff summary posted as a comment; a human resolves it |
| full    | schema, infra, auth, public contracts           | independent review + human approval                   |

Whoever releases or merges a change owns the outcome.

## Who resolves a gate

The gates above name *what* must be satisfied, not *who* satisfies it. By
default that is a human, and a skill running without an explicit autonomous
posture waits.

[plandesk-autonomy](../skills/plandesk-autonomy/SKILL.md) is the one named
override: running unattended under it, an agent may resolve an `approve` or
`full` gate and release `scope` → `todo` itself — **only** with the reasoning
chain posted as a comment first (what "done" means here, what the lane
requires, what verification ran, what would falsify the verdict). A `full` lane
still requires an independent review pass, not the author's own read-back.

That skill is the authority on when this applies. Do not restate its conditions
elsewhere — a permission copied into a second file is a permission that drifts
out of sync with the first, which is exactly how this section came to exist.

## At intake

Assign each task a lane from this file at creation. Then stop. Intake scaffolds;
it does not execute the plan unless the human explicitly asked for that in the
same request — a boundary that holds regardless of who may release, because it
is about not conflating planning with building.
