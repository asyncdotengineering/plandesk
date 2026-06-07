# S0-01 Implementation Notes

## Decisions

- **pnpm native builds:** Added `pnpm.onlyBuiltDependencies` for `better-sqlite3` and `esbuild` so pnpm v10 runs install scripts (required on arm64 macOS).
- **Web stack:** TanStack Router file-based routes with `@tanstack/router-plugin/vite`; TanStack Query wired in `main.tsx`. `routeTree.gen.ts` is build-generated and excluded from ESLint/Prettier.
- **@plandesk/db shell:** Exports `version()` plus `sqliteAvailable()` to verify better-sqlite3 prebuilt binary loads (12.10.0 on this machine).
- **Module resolution:** Node packages use `NodeNext`; web app uses `Bundler` per RFC §4.5 SPA stack.

## Resolved versions (lockfile)

See `pnpm-lock.yaml` after install. Notable: React 19, Vite 8, TanStack Router/Query latest, better-sqlite3 12.10.0, Turbo 2.9.16, TypeScript 5.9.3.

## Deviations

None from S0-01 acceptance criteria.
