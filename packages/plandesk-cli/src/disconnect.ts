import { existsSync, lstatSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeMcpServerEntry, removeSentinelBlock, SKILL_DIRS } from './connect-artifacts.js';

export type DisconnectOptions = {
  repoDir: string;
};

export type DisconnectResult = {
  removed: string[];
};

function readOptionalFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, 'utf8');
}

export function runDisconnect(options: DisconnectOptions): DisconnectResult {
  const removed: string[] = [];
  const repoDir = options.repoDir;

  const plandeskDir = join(repoDir, '.plandesk');
  if (existsSync(plandeskDir)) {
    rmSync(plandeskDir, { recursive: true, force: true });
    removed.push(plandeskDir);
  }

  for (const skillDir of SKILL_DIRS) {
    const dirPath = join(repoDir, skillDir);
    if (lstatSync(dirPath, { throwIfNoEntry: false }) !== undefined) {
      rmSync(dirPath, { recursive: true, force: true });
      removed.push(dirPath);
    }
  }

  const mcpPath = join(repoDir, '.mcp.json');
  const mcpContent = readOptionalFile(mcpPath);
  if (mcpContent !== undefined) {
    const nextMcp = removeMcpServerEntry(mcpContent);
    if (nextMcp === undefined) {
      unlinkSync(mcpPath);
      removed.push(mcpPath);
    } else if (nextMcp !== mcpContent) {
      writeFileSync(mcpPath, nextMcp, 'utf8');
      removed.push(`${mcpPath} (plandesk entry)`);
    }
  }

  for (const relativePath of ['CLAUDE.md', 'AGENTS.md'] as const) {
    const filePath = join(repoDir, relativePath);
    const content = readOptionalFile(filePath);
    if (content === undefined) {
      continue;
    }
    const nextContent = removeSentinelBlock(content);
    if (nextContent === undefined) {
      unlinkSync(filePath);
      removed.push(filePath);
    } else if (nextContent !== content) {
      writeFileSync(filePath, nextContent, 'utf8');
      removed.push(`${filePath} (sentinel block)`);
    }
  }

  for (const commandPath of [
    join(repoDir, '.codex', 'commands', 'plandesk.md'),
    join(repoDir, '.claude', 'commands', 'plandesk.md'),
  ]) {
    if (existsSync(commandPath)) {
      unlinkSync(commandPath);
      removed.push(commandPath);
    }
  }

  return { removed };
}

export function formatDisconnectSummary(result: DisconnectResult): string {
  if (result.removed.length === 0) {
    return 'No Plan Desk connection found.\n';
  }
  const lines = ['Disconnected Plan Desk:', ...result.removed.map((entry) => `- ${entry}`)];
  return `${lines.join('\n')}\n`;
}
