# The heartbeat

Optional companion for long multi-slice runs. A scheduled pulse that catches a
**stalled** slice a long run would otherwise wedge on. It does not define what
"stalled" means — [protocol.md](protocol.md)'s stall detection does.

## A safety net, not a poll

A worker's completion is reported by the harness on exit — do not schedule short
wakeups to poll for it; that is wasted work. The heartbeat is the *fallback* for
the state the harness cannot see: a worker that hangs without exiting, or
external work (a CI run, a remote queue) with no notification.

- **Trigger:** a schedule — `ScheduleWakeup` about every 25 minutes (a Pomodoro
  tick), shorter only if a stall could go unnoticed for longer than that.
- **Each beat:** run protocol.md's stall test against every `in_progress` slice.
  Healthy → sleep to the next tick. Stalled → apply protocol.md's remedy: kill,
  assess the tree (a stalled worker may have finished most of it), and
  re-dispatch only the remainder.

## Push right

Do maximal work before involving the human. Surface a slice to them **only**
when it is genuinely blocked — a decision you cannot make, access you cannot
obtain — and hand them a **brief**: what was produced, why it is blocked, the
decision you need, and a link down to the asset. One late, prepared ask beats a
stream of status pings.
