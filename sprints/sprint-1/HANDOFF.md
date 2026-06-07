# Sprint 1 → Sprint 2 Handoff

**Read me first.** One page to start Sprint 2 (MCP + portability).

## State of the world

- `main`, all green: `pnpm build && pnpm test && pnpm lint` (6 build / 80 tests / lint+Prettier).
- Full local REST + SSE backend works (live-verified). `plandesk init`/`serve` boot it on `127.0.0.1:3847`.
- **Service layer is the single write path**, accepting `{db, eventBus}`; mutations emit SSE inside the service.

## What Sprint 2 builds (WBS § Sprint 2)

MCP server + tools + export/import + the rest of the CLI.

- **S2-01** MCP server + token auth: official `@modelcontextprotocol/sdk`, Streamable HTTP at `/mcp/`, `Authorization: Bearer plandesk_mcp_*` checked against `mcp_tokens` (sha256; raw shown once). Read tools `list_projects`, `get_project`. ≥8 tools declared total.
- **S2-02** MCP write tools as **thin adapters over the existing services** (no second write path): `create_task`, `update_task`, `create_document`, `update_document`, `create_edge`, `start_agent_run`, `record_agent_progress`, `complete_agent_run`. **No delete tool** (RFC §10). Because emits live in services, these broadcast SSE for free — assert it.
- **S2-03** export/import: `plandesk-export-v1` JSON; lossless round-trip with ID remap.
- **S2-04** CLI complete: `export`, `import`, `token create`, `doctor`.

## Critical conventions to carry

- **MCP tools MUST call the api service layer, not the db directly.** That's how REQ-9 (MCP writes broadcast SSE) is satisfied with zero new wiring. The services are in `packages/plandesk-api/src/services/`; expose a small factory if needed so `@plandesk/mcp` can construct them with `{db, eventBus}` — or have the MCP router mount inside the api app sharing the same service instances + bus (preferred: one app, one bus — see RFC §7.1 `app.route('/mcp', ...)`).
- **Reuse `serialize.ts`** for tool outputs → snake_case + ISO, consistent with REST.
- **Token storage:** store `sha256(token)` only; raw shown once at creation. Tools' errors: unknown project → `not_found`; invalid status → `invalid_argument`; bad/absent token → HTTP 401.
- ESM/NodeNext, strict TS 6.0.3, no stubs/`@ts-ignore`, atomic `[S2-NN]` commits, **no scratch files**.
- Fetch live MCP SDK docs (Context7) before wiring the Streamable HTTP transport — pin latest, lock the transport contract in a test.

## Load-bearing reading for Sprint 2

1. `sprints/sprint-1/WARMDOWN.md` (conventions) + this handoff.
2. `sprints/WBS.md` § Sprint 2 + § 1.2 DoD.
3. `../plandesk-rfc/02-requirements-interfaces.md` §4.1 (CLI), §4.3 (MCP tools + endpoint), §3 REQ-7/8/10.
4. `../plandesk-rfc/03-pseudocode-blueprint.md` §6.3 (MCP exec loop), §6.5 (export/import), §7.2 (update_task tool).
5. `../plandesk-rfc/05-security-rollback-open-qs.md` §10 (token handling, no mass-delete).

## Starting state for Sprint 2

Clean `main`, Sprint 1 closed. Next: write `sprints/sprint-2/PLAN.md`, then brief S2-01 → `/delegate --mode impl --to cursor`. The api app + services + eventBus are the foundation the MCP server mounts onto.
