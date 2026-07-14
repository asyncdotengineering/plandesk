<!-- plandesk:start -->
@.plandesk/skill.md
<!-- plandesk:end -->

<!-- plandesk-factory:start -->
## Plan Desk Factory — default operating mode

This repository runs on the Factory workflow. On any work request:
1. **Follow the factory cycle** — the always-on [factory.md](.agents/factory/factory.md) contract governs each work item: pull → read → red gate → act → prove → observe → gate → report. For the session program (orient → intake → execute → finish), read [workflow.md](.agents/factory/workflow.md).
2. **Delegate implementation by default — when a worker is available.** The supervisor orchestrates; IC workers execute. Probe the dispatchers in [.agents/factory/workers/](.agents/factory/workers/) per [protocol.md](.agents/factory/protocol.md) and hand each work item to a probed worker. **If no worker is installed on this machine, do the work yourself under the same contract** — never skip the cycle just because you are the one typing, and never assume a delegation skill or worker CLI exists that this repo did not ship. Write inline without dispatch only for trivial edits, integration/conflict resolution, and review fixes under ~5 lines.
3. **Operate in autonomous-stand mode** — decompose the goal into verifiable moves on a harness task list (`TaskCreate` / `TaskList` / `TaskUpdate`), drive them to zero, and ship without pausing for permission. The full posture is [autonomous-stand.md](.agents/factory/autonomous-stand.md).
4. **Prove before done** — re-run the claimed checks per [protocol.md](.agents/factory/protocol.md); exit codes are authoritative.

New to this repo? Run `plandesk onboard` for the full Plan Desk + Factory model and the operating loop.

@.agents/factory/factory.md
<!-- plandesk-factory:end -->
