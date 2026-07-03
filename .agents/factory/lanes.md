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

The human who releases or merges a change owns the outcome.
