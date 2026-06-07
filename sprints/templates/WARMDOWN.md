# Sprint {N} — Warm-down

> **Author (main session):** {model + timestamp}.
> **Sprint window:** {start} → {end}.
> **Outcome:** {one sentence — was the goal achieved?}

---

## 1. Goal recap

**Sprint goal (from WBS):** {verbatim}

**Did we hit it?** {yes / partial / no — with one paragraph of context}

---

## 2. Stories shipped

| Story | Status | PR | Demo | Notes |
|-------|--------|-----|------|-------|
| S{N}-01 | Done | #{N} | [link](./artifacts/{story}.{ext}) | ... |
| S{N}-02 | Done | #{N} | [link] | ... |
| S{N}-03 | Slipped | — | — | Pulled from sprint; rewritten as backlog BL-{id}. |

If any stories slipped: explain in one paragraph why, and how the rewrite differs from the original.

---

## 3. What's working

Specific, demo-able outcomes. Cite the artifact.

- ...
- ...

---

## 4. What's not working / known issues

Bugs, half-finished pieces, things you didn't test, gaps you noticed.

| ID | Description | Severity | Owner | Tracking |
|----|-------------|----------|-------|----------|
| KI-{N}-01 | ... | major | next sprint | issue #{N} |
| KI-{N}-02 | ... | minor | backlog | BL-{id} |

---

## 5. Decisions made

Especially anything that diverges from RFC-001 / RFC-002 / the wiki. Each decision must cite the synthesis doc that backs it.

- **Decision:** ... . **Rationale:** ... . **Source:** [`sprint-{N}/synthesis-{story}.md`](./synthesis-{story}.md). **RFC amendment:** PR #{N} or "none."

---

## 6. Wiki / RFC amendments this sprint

| Amendment | File | Section | PR |
|-----------|------|---------|----|
| ... | `wiki/03_anatomy.md` | §9.1 | #{N} |
| ... | `rfc/RFC-002-concrete-tech.md` | §6.4 | #{N} |

If none: "No amendments this sprint."

---

## 7. Metrics

If applicable:

- **CI duration** (P50, P95): ...
- **Total package bundle size**: ...
- **Latency** (per-turn P50, P95 on the eval rig): ...
- **Test count**: ... (added this sprint: ...)
- **Lines of code** (per package, if relevant): ...

---

## 8. Backlog updates

**Added:**
- BL-{id}: ...
- BL-{id}: ...

**Promoted from backlog into a future sprint:**
- BL-{id} → planned for sprint {N+k} as story `S{N+k}-{nn}`.

**Removed (no longer relevant):**
- BL-{id}: ...

---

## 9. Retrospective

One paragraph each. Be honest.

### Keep
What worked well that we should keep doing. Be specific.

### Change
What didn't work and why. What would we change next sprint?

### Try next
A small experiment for the next sprint. One thing only — don't try three new things at once.

---

## 10. Pointers for the next sprint

These end up in `HANDOFF.md` more concisely. Here, list the load-bearing things the next session should know:

- Files to read first: ...
- Traps to know about: ...
- Open RFC amendments still in flight: ...
- Open issues that block sprint {N+1}: ...

---

## 11. Closeout

- [ ] All shipped stories have PRs merged.
- [ ] All `Apply now` items from synthesis docs are resolved.
- [ ] Backlog deltas added to `sprints/WBS.md §4`.
- [ ] `sprints/sprint-{N}/HANDOFF.md` written.
- [ ] `sprints/STATE.md` updated with new active sprint pointer + load-bearing reading list.
- [ ] Demo artifacts archived under `sprints/sprint-{N}/artifacts/`.

Sprint {N} is closed.
