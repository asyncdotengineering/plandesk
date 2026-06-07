# Review (r1, sandwich) — `S{N}-{nn}` {title}

> **Reviewer (main session):** {model + timestamp}.
> **Diff under review:** PR #{N} or local branch `sprint-{N}/S{N}-{nn}`.
> **Story brief:** [`brief-{story}.md`](./brief-{story}.md)

The sandwich method: strengths first, substantive critique second, constructive close third. Be egoistic but honest. Generic praise is forbidden — every "good" must cite file:line and explain why. Every critique must cite file:line and a rule from RFC / wiki / DoD that the diff violates.

---

## 1. Strengths

Specific, load-bearing decisions the IC got right. Cite file:line. **Do not include "tests pass" or "compiled cleanly" — those are baseline; if absent, the story is already failing.**

- **{Decision}** at `path/to/file.ts:line`. Why it's right: {reason — cite an RFC § or design doc if the rule lives there}.
- **{Decision}** at `path/to/file.ts:line`. Why it's right: ...
- **{Decision}** at `path/to/file.ts:line`. Why it's right: ...

If you cannot find three load-bearing strengths, say so explicitly: "I could only identify {N} strengths. The diff is competent but not exceptional. The IC met the bar; nothing more." That is honest feedback.

---

## 2. Critique

For each item, fill in:

- **What's wrong** (file:line).
- **Why it's wrong** (cite the rule — RFC § / wiki § / DoD line).
- **Severity:** `blocker` (story can't ship) | `major` (must fix before merge) | `minor` (fix this sprint) | `nit` (defer to backlog).
- **Proposed fix** (one sentence).

Order: blockers first, then majors, minors, nits.

### 2.1 Blockers

#### B1. {short title}
- **Where:** `path/to/file.ts:line`
- **What:** ...
- **Why it violates the spec:** ...
- **Severity:** blocker
- **Proposed fix:** ...

#### B2. ...

### 2.2 Majors

#### M1. {short title}
- **Where:** `path/to/file.ts:line`
- **What:** ...
- **Why:** ...
- **Severity:** major
- **Proposed fix:** ...

### 2.3 Minors

#### m1. {short title}
- **Where:** `path/to/file.ts:line`
- **What:** ...
- **Severity:** minor
- **Proposed fix:** ...

### 2.4 Nits

- {one-line per nit; defer to backlog}

---

## 3. Cross-cutting concerns

Things that don't fit a single line or file. Examples:

- **Test coverage of failure paths:** is every catch block exercised by a test?
- **Type-safety holes:** any `any`, unsafe cast, or `as unknown as`?
- **Performance:** does the diff introduce a `O(n^2)` over the audio frame stream?
- **Concurrency:** any `Promise.race` for cancellation? Any place a worker thread could leak?
- **Telemetry:** does the diff emit every event the spec requires? Any new event added without a wiki amendment?
- **Wire-protocol drift:** does the diff change the WebSocket protocol without bumping `VOICE_PROTOCOL_VERSION`?
- **Bundle size / dependency surface:** any new transitive deps?

Cite specific places where these concerns matter (file:line) — do not list them as abstract worries.

---

## 4. Constructive close

In one paragraph: which fixes you'd recommend tackling first, and what would unblock the rest.

> Example: "Start with B1 (the missing AbortSignal propagation); once that's in place, M1 and M3 are mostly mechanical. The nits can wait. The IC's overall structure is sound; the diff just needs the cancellation discipline RFC-001 §6 calls out."

---

## 5. Verdict

Pick one:

- [ ] **Approve with minor fixes.** Blockers and majors all resolved or none present.
- [ ] **Request changes.** At least one blocker or major. List below.
- [ ] **Reject.** Diff fundamentally diverges from the story brief; recommend a rewrite.

If "Request changes" or "Reject," call out the path forward in one sentence.
