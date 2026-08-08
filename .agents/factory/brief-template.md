---
type: brief-template
version: 1
---

# Brief template

The canonical form of `runs/brief-<task>.md` — the file a dispatched worker
receives as its entire world. [protocol.md](protocol.md) defines the contract
(five sections, what is frozen and what is live); this file makes writing one
mechanical, so no section gets dropped by a supervisor reconstructing the shape
from memory. A dropped section — usually the result contract — is the
documented cause of runs that produce code but no verifiable result.

**How to use:** copy everything below the cut line into
`runs/brief-<task>.md`, replace every `{PLACEHOLDER}`, paste
[workmanship.md](workmanship.md) in full where marked, and delete nothing
else.

Engine-side notes — these never go into the brief:

- **`{CONTEXT_MARKDOWN_URL}`** — mint with `create_share_link` on the task
  (on the goal, for a multi-slice run), `expires: 7d`, and use the returned
  `markdown_url`. The spec is linked live, never pasted — a human editing it
  mid-flight must reach the worker.
- **`{WBS_TABLE}`** — derive from `list_tasks` + `list_edges` at dispatch
  time and paste it frozen — a board re-ordered mid-dispatch must not
  silently redirect a worker already building. Always include the
  do-not-touch line: a worker given one task and no map will helpfully finish
  the next one too.
- **Multi-slice runs** add the slice's branch and integration point as two
  extra rows on the WBS snapshot — [brief.md](brief.md).
- **No secrets, ever.** The share link is public to whoever holds it, and
  the worker's log reprints whatever the brief contains.

---8<--- copy everything below this line ---8<---

# Brief — {TASK_ID}: {TASK_LABEL}

{ONE_OR_TWO_LINES_OF_INTENT — the larger goal this serves, who it is for,
and what the output unlocks. The why behind the acceptance criteria, not a
restatement of them.}

## The result contract — read this first

Write `runs/result-{TASK_ID}.json` before you finish, whatever the outcome:

```json
{
  "status": "done | blocked",
  "claims": [{ "command": "<gate or check actually run>", "exit_code": 0 }],
  "question": "<only when blocked: what decision or input is needed>"
}
```

The result file is the completion signal, not your process exit: present and
parseable means finished; absent means unfinished, regardless of what the
process reported. An invalid result is a failed dispatch, and there are four
ways to write one: no file; `status: "done"` with no claims; a status outside
`done | blocked`; claims that omit any gate command named in **The ground**
below — running some gates honestly is still not satisfying the dispatch.

## The ground

- Repository — work here, absolute path: `{ABS_REPO_PATH}`
- Gate commands to satisfy, run from the repo root (exit 0 = pass; every one
  of these must appear in your claims):
  - `{GATE_COMMAND_1}`
  - `{GATE_COMMAND_2_IF_ANY}`

## The spec — live, re-read it if anything is unclear

Context: {CONTEXT_MARKDOWN_URL}

## Where this sits — frozen at dispatch; build this task, not the plan

{WBS_TABLE}

Owned by later items — do not touch: {DO_NOT_TOUCH_PATHS}

## The bar

{PASTE .agents/factory/workmanship.md IN FULL HERE — everything below its
frontmatter}
