# Handoff — Sprint {N} → Sprint {N+1}

> **One page. Read this before doing anything else.** Depth lives in [`WARMDOWN.md`](./WARMDOWN.md); this is the read-me-first.

---

## State of the world (one paragraph)

Sprint {N} ({sprint name}) is complete. {What shipped in one sentence.} {What this means for the project — one sentence.} {Anything the N+1 session must know up front — one sentence.}

---

## Sprint {N+1} goal (verbatim from WBS)

**{Goal sentence from WBS § Sprint {N+1}}**

The full sprint section is at `sprints/WBS.md` § Sprint {N+1}.

---

## Read these first (in this order, before delegating any story)

1. `sprints/STATE.md` — confirms the active sprint and the load-bearing reading list.
2. `sprints/WBS.md` § Sprint {N+1}.
3. `sprints/sprint-{N}/WARMDOWN.md` — only the sections you need depth on.
4. `rfc/RFC-002-concrete-tech.md` §{X} — {what's there, why it matters now}.
5. `wiki/0{X}_*.md` §{Y} — {what's there}.

If sprint {N+1} is in the recorder or realtime phase:
- Sprint 9–10: also read `research/RECORDER_DESIGN.md` end to end.
- Sprint 11–12: also read `research/REALTIME_KERNEL_DESIGN.md` end to end.

---

## Traps to know about

(things that bit us this sprint and could bite the next session)

- **{Trap 1}**: {one sentence}. Issue: #{N}.
- **{Trap 2}**: {one sentence}.

If none: "No traps from sprint {N}." That is valid.

---

## Open issues that block sprint {N+1}

| Issue | Severity | Status |
|-------|----------|--------|
| #{N} | blocker | Awaiting RFC amendment merge. |
| #{N} | major | Provider key needed; ping the user. |

If none: "No open blockers."

---

## Start by running

```bash
{single command that orients the session — e.g.:}
cd /Users/mithushancj/Documents/asyncdot/openscoped/voice-media-transport && cat sprints/STATE.md && pnpm install --frozen-lockfile && pnpm test
```

---

## When you're done

End the session after the warm-down. The next session will paste `sprints/SESSION_KICKOFF_PROMPT.md` and pick up from `sprints/STATE.md`.
