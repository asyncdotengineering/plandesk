import { createDb, migrate } from '@plandesk/db';
import { runInit } from './init.js';
import { parseArgs, resolveDataDir, usage, workspaceDbPath } from './args.js';
import { runServe } from './serve.js';
import { runTokenCreate } from './token.js';

export function main(argv: string[] = process.argv): number {
  const parsed = parseArgs(argv);

  switch (parsed.command) {
    case 'help':
      process.stdout.write(usage());
      return 0;
    case 'init': {
      const dbPath = runInit(parsed.dataDir);
      process.stdout.write(`Initialized workspace at ${dbPath}\n`);
      return 0;
    }
    case 'serve':
      runServe({ port: parsed.port, dataDir: parsed.dataDir });
      return 0;
    case 'token': {
      const dataDir = resolveDataDir(parsed.dataDir);
      const db = createDb(workspaceDbPath(dataDir));
      migrate(db);
      const token = runTokenCreate(db, parsed.name);
      process.stdout.write(`${token}\n`);
      return 0;
    }
    case 'unknown':
      process.stderr.write(`Unknown command: ${parsed.name}\n\n${usage()}`);
      return 1;
  }
}
