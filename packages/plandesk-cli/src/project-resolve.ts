import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBoundProjectId, parseConfigJson, type AnyPlanDeskConfig } from './connect-artifacts.js';

export class ProjectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectConfigError';
  }
}

function readOptionalFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, 'utf8');
}

function loadConfig(repoDir: string): AnyPlanDeskConfig {
  const configPath = join(repoDir, '.plandesk', 'config.json');
  const content = readOptionalFile(configPath);
  if (content === undefined) {
    throw new ProjectConfigError('Missing .plandesk/config.json. Run plandesk connect first.');
  }
  return parseConfigJson(content);
}

export function resolveProjectId(options: { repoDir: string; projectId?: string }): string {
  const projectId = options.projectId ?? getBoundProjectId(loadConfig(options.repoDir));
  if (projectId === undefined || projectId.trim() === '') {
    throw new ProjectConfigError('Project id is required. Use --project or plandesk connect.');
  }
  return projectId;
}
