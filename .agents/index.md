# Agent workspace

Harness-neutral agent artifacts for this repository, discovered by path.
Consumers must tolerate unknown types, unknown frontmatter keys, and links to
not-yet-written files.

- [factory/factory.md](factory/factory.md) - the factory contract: how delegated agent work cycles run here (and file precedence when policy conflicts)
- [factory/execution.md](factory/execution.md) - IC spine when typing the work: decompose, drive to zero, ship
- [factory/protocol.md](factory/protocol.md) - the deterministic dispatch + result contract for worker CLIs
- [factory/brief-template.md](factory/brief-template.md) - the canonical brief form: copy, substitute placeholders, paste workmanship in full
- [factory/workmanship.md](factory/workmanship.md) - the bar a worker's output must meet; pasted in full into every brief
- [factory/workers/](factory/workers/) - one file per worker: probe (is it installed?) + command template
- [factory/routing.md](factory/routing.md) - which worker for which task shape, the default IC, and the cross-family review rule
- [factory/lanes.md](factory/lanes.md) - risk-lane policy: which changes need which gates, who resolves them, and the human override
- [factory/slicing.md](factory/slicing.md) - optional: cutting a wide frontier into deliverable slices (tracer bullets, expand → contract)
- [factory/brief.md](factory/brief.md) - optional: what multi-slice dispatch adds to a brief (branch, integration point, intent)
- [factory/heartbeat.md](factory/heartbeat.md) - optional: the scheduled stall check for long multi-slice runs
- [factory/verifiers/](factory/verifiers/) - fast per-change checks (exit 0 = pass)
- [skills/](skills/) - Agent Skills (SKILL.md directories) usable by any harness; the roster is `plandesk` and `plandesk-*`
- [skills/plandesk/SKILL.md](skills/plandesk/SKILL.md) - Plan Desk MCP conventions: tasks, documents, edges, comments, artifacts, sharing. Also the source `connect` reads to write `.plandesk/skill.md`, so edit it here and regenerate — never edit the generated copy
- [skills/plandesk-plan-writer/SKILL.md](skills/plandesk-plan-writer/SKILL.md) - RFC / design proposal as a Plan Desk `Design:` document (upstream of scope-work)
- [skills/plandesk-scope-work/SKILL.md](skills/plandesk-scope-work/SKILL.md) - raw signal or a whole idea → `scope` tasks, edges, and a Design doc, with provenance
- [skills/plandesk-groom-task/SKILL.md](skills/plandesk-groom-task/SKILL.md) - one thin task or bare requirement → a build contract, in place; owns the Definition of Ready
- [skills/plandesk-foreman/SKILL.md](skills/plandesk-foreman/SKILL.md) - runs the board floor: groom → dispatch → verify → gate → commit
- [skills/plandesk-autonomy/SKILL.md](skills/plandesk-autonomy/SKILL.md) - chainable posture: run another skill unattended, bounded by the lane gates and a run budget
- [skills/plandesk-timebox/SKILL.md](skills/plandesk-timebox/SKILL.md) - chainable posture: pace a run in timeboxes over a user-defined work list
- [skills/plandesk-standup/SKILL.md](skills/plandesk-standup/SKILL.md) - start-of-session: rebuild context from the last standdown, git, and the board
- [skills/plandesk-standdown/SKILL.md](skills/plandesk-standdown/SKILL.md) - end-of-session: distill shipped/blocked/next into `.plandesk/standdown.md`
- [skills/plandesk-prototype/SKILL.md](skills/plandesk-prototype/SKILL.md) - author click-through HTML prototype screens (self-contained)
- [factory/hooks/](factory/hooks/) - board-as-memory hook scripts (`SessionStart`/`Stop`/`PreCompact`) called from project `.claude/settings.json`
