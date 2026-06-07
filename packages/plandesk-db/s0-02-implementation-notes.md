# S0-02 Implementation Notes

## Decisions

- **Timestamps:** integer epoch-ms via Drizzle `mode: 'timestamp_ms'`; SQL defaults use julianday formula for insert-time auto-set.
- **IDs:** text UUID primary keys (`crypto.randomUUID()` in repositories).
- **Task status validation:** runtime check in repository (`InvalidTaskStatusError`) — Drizzle SQLite enum is compile-time only.
- **document_comments:** table defined per RFC §4.4 (v1.1); no repository methods this story.
- **Migration path:** resolved from `import.meta.url` → `../drizzle` (works from `src/` in tests and `dist/` at runtime).
- **Dropped `sqliteAvailable()`:** superseded by real migrate/repository tests; `version()` retained.

## Tradeoffs

- Explicit `createdAt`/`updatedAt` in repository inserts override SQL defaults for deterministic test assertions.
- `pnpm migrate:kit` script name avoids clashing with exported `migrate()` function.

## Root causes addressed

- Self-referencing `documents.parent_id` FK uses Drizzle `AnySQLiteColumn` callback pattern.
- ESLint `no-confusing-void-expression` on `expect(() => migrate(db))` — wrapped in block body.
