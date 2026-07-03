---
type: verifier
command: npm test
enabled: false
---

# Tests pass

Example verifier. A verifier is a fast, deterministic per-change check:
`command` runs from the repo root and exit code 0 means pass. One check per
file; the filename is the verifier's name. Set `enabled: true` (or delete
this file and add your own) once the command matches this repository.
