# @plandesk/runner

The machine-side agent. It polls a Plan Desk board, claims one actionable task,
briefs a headless coding-agent CLI, runs the task's own gate command, and writes
the outcome back.

**The runner is not the agent.** Every job it does exists *because* it is not
the agent: it decides what to work on, isolates where the work happens, bounds
how long it may run, and judges the result from an exit code rather than from
the worker's opinion of its own output.

## Install

```bash
pnpm --filter @plandesk/runner build
```

`bin/plandesk-runner` is the entry point. Link it, or call it by path.

## Configure

Config lives at `~/.plandesk/runner.toml`, or wherever `PLANDESK_RUNNER_CONFIG`
points, or `--config <path>`.

```toml
board_url  = "http://127.0.0.1:7526"
agent_key  = ""                      # see "Credentials" below
name       = "local-dev"
workdir    = "/Users/you/.plandesk/work"
workers    = ["pi"]                  # [] means "every worker the repo declares"
default_worker = "pi"
```

Only `board_url` and `agent_key` are required. Everything else has a default —
`plandesk-runner doctor` prints the resolved config with the key redacted.

### Credentials

`agent_key` is required as a *field*, and its empty value carries meaning:

| value | behaviour |
| --- | --- |
| `agent_key = "sk-…"` | sent as `Authorization: Bearer sk-…` |
| `agent_key = ""` | **no `Authorization` header at all** — the board resolves the caller as org owner over loopback |
| field absent | `ConfigError` — an omitted credential is a mistake, an empty one is a decision |

An empty key is the correct setting for a **local** board. A local board cannot
mint an agent key: owner keys come only from the `plandesk login` device flow,
and `plandesk connect` locally mints no token by design. Sending an invalid
bearer is worse than sending none, because the board rejects any bearer that is
not a real key rather than falling through to the loopback path.

Use a real key against a hosted board.

## Workers

Which worker runs is a **three-way intersection**, and none of the three is
sufficient alone:

1. **The repository declares it** — a `.md` file under
   `.agents/factory/workers/` carrying a `headless:` key. A worker file without
   that key stays valid for interactive use and is skipped here.
2. **The machine enables it** — `workers` in `runner.toml`. Empty means "accept
   everything the repo declared".
3. **A live probe passes** — the worker's `probe` command exits 0. A binary on
   `PATH` may still be unauthenticated.

A failing probe removes only that worker; the others still resolve.

The declarations are read from the **worktree**, not from wherever the runner
was launched. A repository the runner is asked to work in must ship its own
`.agents/factory/workers/`, or there are no usable workers for it.

## Run

```bash
plandesk-runner doctor                  # config, board reachability, auth mode, worker rows
plandesk-runner --once --project <id>   # claim at most one task, settle it, exit
plandesk-runner --project <id>          # poll forever
```

`doctor` probes the board **twice**: once unauthenticated for reachability, once
authenticated. Health alone is not enough — it answers without a credential, so
a runner whose key the board rejects would otherwise report a healthy board and
then fail every real call.

```
board http://127.0.0.1:7526: reachable (HTTP 200) — auth loopback: accepted (HTTP 200)
board https://board.example.com: reachable (HTTP 200) — auth bearer: REJECTED (HTTP 401) — every board call will fail
```

## The gate

A task states its own validation command. The runner looks for either form:

````markdown
```gate
pnpm --filter @plandesk/runner test
```
````

```markdown
gate: pnpm --filter @plandesk/runner test
```

The gate is one command, because it is exec'd as argv rather than through a
shell. **A task with no gate resolves `failed`** — the runner never assumes
success for work it cannot check.

Outcome is decided in this order, and nothing else participates:

| condition | outcome |
| --- | --- |
| `.plandesk/NEEDS_INPUT.md` exists in the worktree | `needs_input` → task to `scope` |
| worker exit ≠ 0 | `failed` (the gate is **not** run) → task to `todo` |
| gate exit 0 | `done` |
| gate exit ≠ 0 | `failed` → task to `todo` |

On `done`, the lane decides what happens next: `auto` closes the task, while
`approve` and `full` leave it `in_progress` with a progress event saying it
awaits a human.

## End-to-end check

```bash
pnpm --filter @plandesk/runner e2e                 # all four paths
pnpm --filter @plandesk/runner e2e -- --path=happy # one path
```

This is the only check that proves the runner moves a real task on a real
board. The unit suite asserts every module against stubs; a green unit suite is
necessary and never sufficient.

It provisions everything itself: a scratch git repository served by a local
`git daemon` over `git://` (the board's `repo_url` allowlist rejects `file:` on
purpose), an isolated workdir per run, and its own throwaway project. It removes
all of it afterwards, so running it twice leaves no residue.

**Requirements:** a reachable board, a runner config, and at least one worker
whose probe passes. Missing any of those, it exits 0 with an explicit skip
message naming what was absent — never a silent pass.

The four paths and what each pins down:

| path | gate | proves |
| --- | --- | --- |
| `happy` | `true` | task reaches `done`, run `completed` |
| `failure` | `false` | task returns to `todo`, run `failed`, gate output recorded |
| `park` | `true` | a worker question parks the task in `scope` and reaches the run |
| `approve` | `true` | lane `approve` holds at `in_progress` for a human |

The gate commands are deliberately `true`/`false`: they isolate the runner's
plumbing from whether the worker happened to write good code.

## Isolation and cleanup

Each attempt gets its own `git worktree` under `<workdir>/worktrees/<taskId>`,
branched from a full commit OID resolved from the remote's default branch.

**Cleanup fails closed.** A worktree is removed only when the tree is provably
clean *and* the branch is provably pushed. Dirty, failed, parked, or unprovable
worktrees are retained with a reason, because a wrong `git worktree remove`
destroys work no one has seen. Ignored-only content such as `node_modules` does
not block removal, and is listed in the decision.

Workers are spawned into their own process group with a constructed environment
— `PATH HOME USER LANG TERM TMPDIR` and nothing else — so the board credential
never reaches a worker. `HOME` is load-bearing: pi resolves its provider auth
from `~/.pi/agent/auth.json`.

On startup the runner reconciles orphans: a task left `in_progress` by a crashed
run is returned to `todo`, and its worktree is retained for inspection.
Reconcile never deletes anything.
