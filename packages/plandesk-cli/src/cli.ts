import { runInit } from './init.js';
import { parseArgs, usage } from './args.js';
import { runServe } from './serve.js';

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
    case 'unknown':
      process.stderr.write(`Unknown command: ${parsed.name}\n\n${usage()}`);
      return 1;
  }
}
