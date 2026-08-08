---
type: verifier
command: pnpm test
enabled: true
---

# Tests pass

The repo-wide suite: `pnpm test` runs `turbo run test` across every package
from the root. This is the red-gate and claim-verification command for
implementation work — a per-package subset is a sample, not a gate
(protocol.md). Exit code 0 means pass.
