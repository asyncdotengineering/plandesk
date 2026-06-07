# Plan Desk

**Local-first, self-hostable planning workspace** — canvas + docs-on-nodes + tasks + board + MCP for product teams and agent workflows.

Plan Desk is a graph-native planning app you run on your machine: map dependencies on a flow canvas, attach specs to nodes, track status on a board, and let Claude Code or Codex read and update the plan over MCP. Data stays in a local SQLite workspace; export/import keeps projects portable.

## Documentation

📖 **[plandesk-docs.pages.dev](https://plandesk-docs.pages.dev)** — hosted documentation: quickstart, Docker self-hosting, MCP/agent setup, CLI reference, API, architecture, and validation.

Built with Astro Starlight in [`apps/docs`](apps/docs/):

```bash
pnpm --filter @plandesk/docs dev      # http://localhost:4321
pnpm --filter @plandesk/docs build    # static site in apps/docs/dist/
```

## Quickstart

```bash
npm i -g @plandesk/cli
plandesk init
plandesk serve
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847).

**From source (contributors):**

```bash
git clone https://github.com/asyncdotengineering/plandesk
cd plandesk
pnpm install && pnpm build
export PATH="$PWD/packages/plandesk-cli/bin:$PATH"
plandesk init
plandesk serve
```

## Development

```bash
pnpm build          # compile all packages + web assets + docs
pnpm test           # unit + integration tests
pnpm lint           # ESLint + Prettier
pnpm validate       # live health + MCP smoke
pnpm metrics        # v1 performance targets
```

## License

Private / see repository owner.
