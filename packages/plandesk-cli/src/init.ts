import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createBetterAuth,
  ensureLocalBetterAuthOrganization,
  runBetterAuthMigrations,
} from '@plandesk/api';
import { createDb, migrate } from '@plandesk/db';
import { DEFAULT_PORT, resolveInitDataDir, workspaceDbPath } from './args.js';
import { appendGitignoreLine, readWorkspaceJson, writeWorkspaceJson } from './connect-artifacts.js';

export const BETTER_AUTH_SECRET_FILE = 'better-auth-secret';

export function ensureLocalBetterAuthSecret(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const gitignorePath = join(dataDir, '.gitignore');
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : undefined;
  writeFileSync(gitignorePath, appendGitignoreLine(gitignore, BETTER_AUTH_SECRET_FILE), 'utf8');

  const secretPath = join(dataDir, BETTER_AUTH_SECRET_FILE);
  if (!existsSync(secretPath)) {
    try {
      writeFileSync(secretPath, `${randomBytes(32).toString('base64url')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
    } catch (err) {
      if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  const secret = readFileSync(secretPath, 'utf8').trim();
  if (secret.length === 0) throw new Error(`${secretPath} is empty`);
  return secret;
}

export type RunInitOptions = {
  localDb?: boolean;
};

export async function runInit(
  dataDirOverride?: string,
  options: RunInitOptions = {},
): Promise<string> {
  const dataDir = resolveInitDataDir(dataDirOverride, options.localDb === true);
  mkdirSync(dataDir, { recursive: true });
  const betterAuthSecret = ensureLocalBetterAuthSecret(dataDir);
  const dbPath = workspaceDbPath(dataDir);
  const db = await createDb(dbPath);
  await migrate(db);
  const auth = createBetterAuth({
    client: db.$client,
    secret: betterAuthSecret,
    baseURL: 'http://127.0.0.1',
  });
  if (auth === undefined) throw new Error('Local better-auth secret was not created');
  await runBetterAuthMigrations(auth);
  await ensureLocalBetterAuthOrganization(db, auth);

  // One global board → one fixed port. Record it so `connect` / `url` resolve
  // without a live server.json. Do not overwrite a pre-existing assignment.
  if (readWorkspaceJson(dataDir) === undefined) {
    writeWorkspaceJson(dataDir, DEFAULT_PORT);
  }

  return dbPath;
}
