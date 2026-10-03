import {
  getBoundProjectId,
  readPlandeskConfig,
  type AnyPlanDeskConfig,
} from './connect-artifacts.js';

export class ProjectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectConfigError';
  }
}

function loadConfig(repoDir: string): AnyPlanDeskConfig {
  const config = readPlandeskConfig(repoDir);
  if (config === undefined) {
    throw new ProjectConfigError('Missing .plandesk/config.json. Run plandesk connect first.');
  }
  return config;
}

export function resolveProjectId(options: { repoDir: string; projectId?: string }): string {
  const projectId = options.projectId ?? getBoundProjectId(loadConfig(options.repoDir));
  if (projectId === undefined || projectId.trim() === '') {
    throw new ProjectConfigError('Project id is required. Use --project or plandesk connect.');
  }
  return projectId;
}
