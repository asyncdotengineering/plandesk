---
type: worker
probe: command -v codex
command: codex exec --full-auto < {prompt_file}
---

# codex

Adversarial review and live-smoke worker — prefer it as the reviewer
when the act worker is a Claude-family run. Verify flags against your
installed version (`codex --help`).

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run `command` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).

Gotcha (observed): `codex exec --full-auto` reliably writes the code but often
does NOT write the `runs/result-<task>.json` contract file even when the brief
demands it. Treat a missing result file as "claims unverified" and run the gate
commands yourself — do not skip verification because the files look done.
