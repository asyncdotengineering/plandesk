# Contract (for callers / the autonomy loop)

```
groom(mode?: "task" | "filter" | "text", target?: string)
  → for each task:
      { task_id: string,
        kind: "build" | "decision",
        verdict: "ready" | "not-ready",
        failing: string[],          // Definition of Ready rows that failed (per kind)
        changed: string[],          // description fields rewritten
        inferred: string[],         // claims the source did not state
        open_questions: string[],   // decisions left to a human (not resolved here)
        provenance: { sources: string[], reason: string } }
```

- `status` is never an output of this skill.
- A run over an empty filter is a no-op — report "nothing to groom", do not
  invent work.
- Provenance uses the same `{ sources, reason }` shape recorded in
  [scope-work](../plandesk-scope-work/SKILL.md), so a task's history reads the same
  however it got onto the board.
