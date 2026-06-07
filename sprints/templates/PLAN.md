# Sprint {N} — Plan

**Sprint name:** {name from WBS}
**Sprint goal (one sentence):** {verbatim from WBS}
**Sprint window:** {start date} → {end date}
**Author (main session):** {model + date stamp}

---

## 1. Stories

For each story `S{N}-{nn}`, fill in the four fields. Acceptance criteria are authored by the main session — they are concrete, testable, and prioritized.

### `S{N}-01` — {title from WBS}

**Description:** {one paragraph, expanded from WBS}

**Acceptance criteria** (numbered, in priority order):
1. ...
2. ...
3. ...

**Files expected to be created or modified:**
- `packages/.../src/...`
- `packages/.../src/...test.ts`
- `examples/.../...`
- `apps/.../...`

**Test fixtures the worker will add:**
- ...

**Demo artifact:** {what gets attached to the PR — `.wav`, screencast, asciinema, etc.}

### `S{N}-02` — {title from WBS}
...

(repeat per story)

---

## 2. Universal DoD checklist (per story)

Copy this checklist into every story brief. The story is not closed until every box is ticked.

- [ ] CI green on Node 20, Node 22, Bun 1.1+; macOS + Ubuntu.
- [ ] Behavioral coverage: every public surface tested with at least one happy-path and one failure-path test.
- [ ] Proof JSON written; manager proceed evidence = **PROCEED**
- [ ] Demo artifact attached (per story or per sprint per PLAN §4)
- [ ] No `--no-verify`, no `@ts-ignore`, no `try/except: pass`.
- [ ] PR description includes story id + DoD checklist + demo link.

---

## 3. Test plan

| Story | Layer | Test type | Fixtures |
|-------|-------|-----------|----------|
| S{N}-01 | unit | ... | ... |
| S{N}-01 | e2e | ... | ... |
| S{N}-02 | unit | ... | ... |
| S{N}-02 | integration | ... | ... |

What we will NOT test in this sprint, and why each is safe:
- ...

---

## 4. Demo plan

The artifact attached to the sprint summary at warm-down. Pick the smallest meaningful slice that exercises every story.

**Demo:** {one paragraph describing the recorded artifact}

---

## 5. Risks specific to this sprint

| Risk | Detection signal | Mitigation |
|------|------------------|------------|
| ... | ... | ... |

---

## 6. Open questions

Real ones. If the WBS is ambiguous or stale on a point, surface it here before the work starts.

- ...
