import { existsSync } from 'node:fs';
import { createDb } from '@plandesk/db';
import { defaultDataDir, findLocalWorkspaceDir, workspaceDbPath, type BoardSource } from './args.js';
import { isPidAlive, readServerInfoRaw } from './connect-artifacts.js';
import { countRows, listTables } from './database-schema.js';

export type BoardStatus = {
  dataDir: string;
  source: BoardSource;
  running: boolean;
  pid?: number;
  port?: number;
  projectCount: number;
};

/**
 * Enumerate every board this machine/repo knows about — the global default
 * board plus any repo-local shadow board reachable from `startDir` (REQ-A4a).
 * Running state and port come from each board's own server.json, judged by
 * PID liveness (not just presence of the file — a stale file must not read
 * as "running").
 */
export async function runStatus(
  opts: { startDir?: string; defaultDir?: string } = {},
): Promise<BoardStatus[]> {
  const startDir = opts.startDir ?? process.cwd();
  const defaultDir = opts.defaultDir ?? defaultDataDir();

  const candidates = new Map<string, BoardSource>();
  candidates.set(defaultDir, 'default');
  const shadow = findLocalWorkspaceDir(startDir);
  if (shadow !== undefined && !candidates.has(shadow)) {
    candidates.set(shadow, 'shadow');
  }

  const boards: BoardStatus[] = [];
  for (const [dataDir, source] of candidates) {
    const dbPath = workspaceDbPath(dataDir);
    if (!existsSync(dbPath)) {
      continue;
    }

    const info = readServerInfoRaw(dataDir);
    const running = info !== undefined && isPidAlive(info.pid);

    let projectCount = 0;
    try {
      const db = await createDb(dbPath);
      const tables = await listTables(db);
      if (tables.includes('projects')) {
        projectCount = await countRows(db, 'projects');
      }
    } catch {
      // Unreadable board (corrupt, mid-write) — report 0 rather than crash status.
    }

    boards.push({
      dataDir,
      source,
      running,
      ...(running && info !== undefined ? { pid: info.pid } : {}),
      ...(info !== undefined ? { port: info.port } : {}),
      projectCount,
    });
  }

  return boards;
}

function padColumns(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows.map((row) => row.map((cell, col) => cell.padEnd(widths[col]!)).join('  ').trimEnd());
}

export function formatStatusReport(boards: BoardStatus[]): string {
  if (boards.length === 0) {
    return 'No Plan Desk boards found.\n';
  }
  const header = ['BOARD', 'SOURCE', 'PORT', 'PID', 'PROJECTS'];
  const rows = boards.map((b) => [
    b.dataDir,
    b.source,
    b.port !== undefined ? String(b.port) : '-',
    b.running && b.pid !== undefined ? String(b.pid) : '-',
    String(b.projectCount),
  ]);
  return `${padColumns([header, ...rows]).join('\n')}\n`;
}
