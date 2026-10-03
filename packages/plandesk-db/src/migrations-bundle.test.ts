import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = fileURLToPath(new URL('../', import.meta.url));

describe('bundled migrations', () => {
  it('match drizzle/ (run `pnpm --filter @plandesk/db generate` after adding a migration)', () => {
    // --check exits non-zero when src/migrations.generated.ts is stale.
    expect(() =>
      execFileSync('node', ['scripts/bundle-migrations.mjs', '--check'], {
        cwd: packageDir,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('load without the filesystem, so Workers and bundled functions can migrate', () => {
    for (const file of ['migrate.ts', 'schema-drift.ts', 'migrations.generated.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/from '(node:|drizzle-orm\/libsql\/migrator)/);
    }
  });
});
