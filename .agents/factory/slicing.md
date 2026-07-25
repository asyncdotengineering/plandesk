# Cutting slices

Optional companion when a goal's frontier is wider than one serial cycle.
How to turn a groomed frontier into deliverable units. The default factory
cycle is still one work item at a time — use this only when you deliberately
cut the frontier into slices.

## Tracer bullets (the default)

A **tracer bullet** cuts a narrow but *complete* path through every layer it
touches — schema, service, API, UI, tests — not a horizontal slice of one layer.

- Each slice is **demoable or verifiable on its own** the moment it lands green.
- Each slice is sized to fit **one worker's fresh context** — if it won't, split it.
- Slices are grouped by cohesion and **minimal file overlap**, so workers in
  parallel worktrees don't collide. Two slices that must edit the same lines
  belong in one slice, or are sequenced by an edge.
- **Prefactor first.** "Make the change easy, then make the easy change" — a
  task that only reshapes existing code to make later slices land goes at the
  front, as its own slice.

## Wide refactors — the exception: expand → contract

A **wide refactor** is one mechanical change whose **blast radius** fans across
the codebase — rename a column, retype a shared symbol — so a single edit breaks
hundreds of call sites at once and no tracer bullet can land green. Do not force
it into a slice. Sequence it:

1. **Expand.** Add the new form beside the old so nothing breaks. One slice, no
   callers migrated yet.
2. **Migrate.** Move call sites to the new form in batches sized by blast radius
   (per package, per directory). Each batch is its own slice, blocked by the
   expand; CI stays green batch to batch because the old form still exists.
3. **Contract.** Delete the old form once no caller remains. One slice, blocked
   by every migrate batch.

When even the batches can't stay green alone, keep the sequence but let them
share an **integration branch** that all block a final *integrate-and-verify*
slice — green is promised only there. Name that integration point in the slice.

## What goes in a slice, what doesn't

The task descriptions already hold the build contract. A slice is just the
grouping: which tasks, in what order, on which branch, and where (if anywhere)
they integrate. Do not re-specify the work here — point at the board tasks.
