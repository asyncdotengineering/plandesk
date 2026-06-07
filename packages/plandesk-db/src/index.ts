import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');

export const version = (): string => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
};

export const sqliteAvailable = (): boolean => {
  const db = new Database(':memory:');
  const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };
  db.close();
  return row.ok === 1;
};
