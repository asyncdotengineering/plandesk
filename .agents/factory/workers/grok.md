---
type: worker
probe: command -v grok
command: grok --prompt-file {prompt_file} --model grok-4.5 --always-approve --output-format plain
---

# grok

Fast implementation worker (default IC). Model ids change between releases —
run `grok models` and pin what is actually installed; a stale id fails the
dispatch immediately with "unknown model id". Never pass `--sandbox` — omitting it grants full IC
access; `--sandbox` is opt-in to restrict, only for untrusted third-party
code.

**Free-tier accounts hit a usage limit.** When they do, grok exits 0 having
written nothing — the run reads as a clean success unless you check for the
result file. Observed twice. This is the case the result-contract rule exists
for: the file is the completion signal, not the exit code.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run `command` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).
