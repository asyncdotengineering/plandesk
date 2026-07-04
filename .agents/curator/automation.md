---
type: curator-skill
version: 1
---

# Curator: automation (schedule + board-event triggers)

Auto-triage is only "auto" if it runs without someone opening the app
(Modem's Automations). This wires [triage.md](triage.md) to a cadence and to
board events, with zero new infrastructure — no daemon, no webhook server,
no new Plan Desk service. Everything here composes existing pieces: the
Claude Code CLI, the `schedule` skill/cron, the board-as-memory hooks
([F1](hooks/)), and `agent_runs`/SSE the web app already streams.

**Spec:** RFC §6 · PRD stories 10, 11 · REQ-6.

## Schedule trigger

Run a headless Claude Code session on a cadence that does exactly two
things, in order: `sync_pull` (refresh submissions from the sync server, a
no-op if the project has no published share) then the [triage.md](triage.md)
pass over `backlog` (the default adapter — add `submissions` too if the
project has a share configured).

Set this up with the `schedule` skill (`CronCreate`) rather than building a
scheduler into Plan Desk:

```
schedule: every 1h (adjust to backlog volume)
prompt:   "Run .agents/curator/triage.md against the current project's
           backlog and pending submissions. Follow the confidence gate
           below. Do not ask for confirmation — this is an unattended run."
```

A cadence of 1–4 hours is a reasonable default for a solo/small-team backlog;
widen or tighten based on how much raw signal actually accumulates (there is
no metrics ledger yet to justify a specific number — this is a starting
point, not a tuned constant).

## Event triggers

There is no push-based event bus to hook into without adding new
infrastructure (a real webhook/queue is Phase X's runner territory, out of
scope here). Instead, ride the moments an agent is already looking at the
board:

- **On session start** — the F1 board-as-memory hook (see [hooks/](hooks/))
  already re-hydrates board state on `SessionStart`. When that hydration
  shows new items in `backlog` or new pending submissions since the last
  recorded progress, that is the trigger: run a triage pass before starting
  (or resuming) whatever else the session was asked to do.
- **On `sync_pull`** — whenever an agent or the schedule trigger above calls
  `sync_pull` and it reports `pending > 0`, immediately follow with a triage
  pass over the newly-pulled submissions. Don't leave a pull sitting
  untriaged in the same session that fetched it.
- **On a task landing in `backlog`** — there's no server push for this
  either; the practical trigger is the same as the schedule cadence (a
  periodic `list_tasks(status: "backlog")` sweep) plus the session-start
  check above. If `agent_runs`/SSE volume ever justifies a real push
  listener, that's a Phase X candidate (see the "Wire risk lanes to
  orchestrator waitpoints" / Trigger.dev backlog tasks) — not before.

## Confidence gate

Not every item triage touches should land in `scope` unattended. Before
writing anything, classify:

| severity | confidence (dedup + fit are unambiguous) | outcome |
| --- | --- | --- |
| low | high | proceed to `scope` per triage.md, normally |
| low | low | leave `pending` (submission) or untouched (backlog task) + proposal comment |
| medium/high | any | leave `pending`/untouched + proposal comment — a human decides, always |

"Confidence" here means: the dedup check found either a clear duplicate or
clearly nothing, AND the item maps cleanly to house-style task fields
without guessing at scope. If drafting the task required inventing details
not present in the source item, confidence is low — say so in the proposal
comment rather than fabricating specifics.

This gate is deliberately conservative on the high-severity side: per RFC
§11, if dedup/severity-judgment precision is unacceptable on real data,
widen the auto-`scope` band only once the metrics ledger backs it — start
narrow.

## What never changes

`scope → todo` stays human-only, on every trigger path, with no exception.
An unattended scheduled run has exactly the same authority as an
interactively-invoked one — automation is not a loophole for a stronger
autonomy grant (see [autonomy.md](autonomy.md)).

## References

RFC §6 (REQ-6); PRD stories 10, 11; [triage.md](triage.md) (what runs);
[provenance.md](provenance.md) (still required on every automated decision);
`hooks/` (F1, the session-start re-hydration this rides on); Modem
Automations (the pattern this distills); backlog tasks "Stand up self-hosted
Trigger.dev runner" / "Wire risk lanes to orchestrator waitpoints" (Phase X —
where a real push-based event bus belongs, deferred).
