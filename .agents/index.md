# Agent workspace

Harness-neutral agent artifacts for this repository, discovered by path.
Consumers must tolerate unknown types, unknown frontmatter keys, and links to
not-yet-written files.

- [factory/factory.md](factory/factory.md) - the factory contract: how delegated agent work cycles run here
- [factory/execution.md](factory/execution.md) - IC spine when typing the work: decompose, drive to zero, ship
- [factory/protocol.md](factory/protocol.md) - the deterministic dispatch + result contract for worker CLIs
- [factory/workers/](factory/workers/) - one file per worker: probe (is it installed?) + command template
- [factory/routing.md](factory/routing.md) - which worker for which task shape, and the cross-family review rule
- [factory/lanes.md](factory/lanes.md) - risk-lane policy: which changes need which human gates
- [factory/verifiers/](factory/verifiers/) - fast per-change checks (exit 0 = pass)
- [skills/](skills/) - Agent Skills (SKILL.md directories) usable by any harness; every shipped skill is `plandesk-*`
- [skills/plandesk-plan-writer/SKILL.md](skills/plandesk-plan-writer/SKILL.md) - RFC / design proposal as a Plan Desk `Design:` document (upstream of scope-work)
- [skills/plandesk-scope-work/SKILL.md](skills/plandesk-scope-work/SKILL.md) - raw signal or a whole idea → `scope` tasks, edges, and a Design doc, with provenance
- [skills/plandesk-groom-task/SKILL.md](skills/plandesk-groom-task/SKILL.md) - one thin task or bare requirement → a build contract, in place; owns the Definition of Ready
- [skills/plandesk-foreman/SKILL.md](skills/plandesk-foreman/SKILL.md) - runs the board floor: groom → dispatch → verify → commit, stopping at the risk lane
- [skills/plandesk-autonomy/SKILL.md](skills/plandesk-autonomy/SKILL.md) - chainable posture: run another skill unattended, bounded by the lane gates
- [skills/plandesk-timebox/SKILL.md](skills/plandesk-timebox/SKILL.md) - chainable posture: pace a run in timeboxes over a user-defined work list
- [factory/hooks/](factory/hooks/) - board-as-memory hook scripts (`SessionStart`/`Stop`/`PreCompact`) called from project `.claude/settings.json`
