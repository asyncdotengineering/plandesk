---
type: protocol
version: 1
---

# Dispatch protocol

The deterministic contract between the supervising agent (the engine) and any
worker CLI. There is no SDK binding: the only contract is files in, one JSON
shape out — any CLI agent that can follow instructions satisfies it.

## Dispatch (engine side)

1. Pick a worker file from [workers/](workers/) whose `probe` exits 0 on this
   machine. Never assume a worker exists; never invoke flags from memory —
   only the file's `command` template, with `{prompt_file}` substituted.
2. Write the brief to `runs/brief-<task>.md`: the task, its spec, the gate
   command(s) to satisfy, and the result contract below.
3. Run the command. One process per dispatch, headless, from the repo root.

## Result (worker side)

The brief instructs the worker to end by writing `runs/result-<task>.json`:

```json
{
  "status": "done | blocked",
  "claims": [{ "command": "<gate or check run>", "exit_code": 0 }],
  "question": "<only when blocked: what decision or input is needed>"
}
```

## Verification (engine side — deterministic, no model judgment)

- `status: done` with no `claims` is invalid — treat as failed.
- Re-run each claimed command; a claim whose re-run exit code differs from the
  claimed one is a false claim — treat the dispatch as failed, record it, and
  do not retry the same approach blindly.
- Only after claims verify does the engine read the diff and apply the lane
  gate from [lanes.md](lanes.md).

Exit codes are authoritative. Model output is metadata.
