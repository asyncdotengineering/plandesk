// Host-side helpers for smoke-deploy.mjs that need the built workspace
// packages (`pnpm build`). Each subcommand runs in its own process so the
// orchestrator stays stdlib-only.
//
//   node scripts/smoke/helpers.mjs owner-cookie <dbUrl> <baseURL>   (secret: PLANDESK_BETTER_AUTH_SECRET)
//   node scripts/smoke/helpers.mjs stale-db <dbUrl>
//   node scripts/smoke/helpers.mjs serve-vercel <port>
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url);
const load = (path) => import(new URL(path, root).href);
const [cmd, ...args] = process.argv.slice(2);

// Plain client, not @plandesk/db createDb: the helpers must not share the
// product's connection setup, or a bug there would mask itself here.
async function openDb(url) {
  const { createClient } = await load(
    'packages/plandesk-db/node_modules/@libsql/client/lib-esm/node.js',
  );
  const { drizzle } = await load('packages/plandesk-db/node_modules/drizzle-orm/libsql/index.js');
  return drizzle(createClient({ url }));
}

if (cmd === 'owner-cookie') {
  // The org + shell owner come from `plandesk admin invite-owner`; this mints
  // the browser session that GitHub sign-in would, so the caller can exchange
  // it for an owner key at POST /api/v1/auth/cli-token (what `plandesk login` uses).
  const [dbUrl, baseURL] = args;
  const secret = process.env.PLANDESK_BETTER_AUTH_SECRET;
  const api = await load('packages/plandesk-api/dist/index.js');
  const db = await openDb(dbUrl);
  const auth = api.createBetterAuth({ client: db.$client, secret, baseURL });
  const org = await api.ensureLocalBetterAuthOrganization(db, auth);
  const { headers } = await api.ensureShellOwner(auth, org.id);
  process.stdout.write(headers.get('cookie'));
} else if (cmd === 'stale-db') {
  // Migration N-1: apply every shipped migration but the last, then hold the
  // lease so a booting server can neither migrate nor serve.
  const [dbUrl] = args;
  const { migrate } = await load(
    'packages/plandesk-db/node_modules/drizzle-orm/libsql/migrator.js',
  );
  const folder = mkdtempSync(join(tmpdir(), 'smoke-drizzle-'));
  cpSync(new URL('packages/plandesk-db/drizzle', root), folder, { recursive: true });
  const journalPath = join(folder, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const dropped = journal.entries.pop();
  writeFileSync(journalPath, JSON.stringify(journal));
  const db = await openDb(dbUrl);
  await db.$client.execute('PRAGMA foreign_keys = OFF');
  await migrate(db, { migrationsFolder: folder });
  rmSync(folder, { recursive: true, force: true });
  await db.$client.execute(
    'CREATE TABLE IF NOT EXISTS __plandesk_lease (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL)',
  );
  await db.$client.execute({
    sql: 'INSERT OR REPLACE INTO __plandesk_lease (id, holder, expires_at) VALUES (1, ?, ?)',
    args: ['smoke-deploy', 4102444800000], // 2100-01-01 in ms
  });
  process.stdout.write(`applied ${journal.entries.length}, withheld ${dropped.tag}, lease held`);
} else if (cmd === 'serve-vercel') {
  // No Vercel account needed: the built handler behind a plain Node server.
  const [port] = args;
  const { serve } = await load(
    'packages/plandesk-api/node_modules/@hono/node-server/dist/index.mjs',
  );
  const { default: handler } = await load('packages/plandesk-server/dist/vercel.js');
  serve({ fetch: handler, port: Number(port), hostname: '127.0.0.1' });
} else {
  process.stderr.write(`unknown helper: ${cmd}\n`);
  process.exit(2);
}
