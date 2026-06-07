import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { normalizeServerUrl, parseConfigJson, type PlanDeskConfig } from './connect-artifacts.js';

export type BindingDoctorReport = {
  present: boolean;
  config?: PlanDeskConfig;
  serverReachable: boolean;
  tokenValid: boolean;
  projectExists: boolean;
  mcpToolCount: number;
  issues: string[];
};

function readToken(repoDir: string): string | undefined {
  const tokenPath = join(repoDir, '.plandesk', 'token');
  if (!existsSync(tokenPath)) {
    return undefined;
  }
  const token = readFileSync(tokenPath, 'utf8').trim();
  return token === '' ? undefined : token;
}

async function listMcpTools(serverUrl: string, token: string): Promise<number> {
  const client = new Client({ name: 'plandesk-doctor', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${normalizeServerUrl(serverUrl)}/mcp`),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  );
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    return tools.tools.length;
  } finally {
    await client.close();
  }
}

export async function runBindingDoctor(repoDir: string): Promise<BindingDoctorReport> {
  const configPath = join(repoDir, '.plandesk', 'config.json');
  const issues: string[] = [];

  if (!existsSync(configPath)) {
    return {
      present: false,
      serverReachable: false,
      tokenValid: false,
      projectExists: false,
      mcpToolCount: 0,
      issues: [],
    };
  }

  const config = parseConfigJson(readFileSync(configPath, 'utf8'));
  const token = readToken(repoDir);
  if (token === undefined) {
    issues.push('missing .plandesk/token');
  }

  let serverReachable = false;
  let tokenValid = false;
  let projectExists = false;
  let mcpToolCount = 0;

  try {
    const health = await fetch(`${config.serverUrl}/api/v1/projects`);
    serverReachable = health.ok;
    if (!serverReachable) {
      issues.push(`server unreachable at ${config.serverUrl}`);
    }
  } catch {
    issues.push(`server unreachable at ${config.serverUrl}`);
  }

  if (token !== undefined && serverReachable) {
    const projectResponse = await fetch(`${config.serverUrl}/api/v1/projects/${config.projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (projectResponse.status === 401) {
      issues.push('token invalid or revoked');
    } else if (projectResponse.ok) {
      tokenValid = true;
      projectExists = true;
    } else if (projectResponse.status === 404) {
      tokenValid = true;
      issues.push(`bound project not found: ${config.projectId}`);
    } else {
      issues.push(`project check failed with status ${String(projectResponse.status)}`);
    }

    if (tokenValid) {
      try {
        mcpToolCount = await listMcpTools(config.serverUrl, token);
        if (mcpToolCount === 0) {
          issues.push('MCP tools list is empty');
        }
      } catch {
        issues.push('failed to list MCP tools');
      }
    }
  }

  return {
    present: true,
    config,
    serverReachable,
    tokenValid,
    projectExists,
    mcpToolCount,
    issues,
  };
}

export function formatBindingDoctorReport(report: BindingDoctorReport): string[] {
  if (!report.present) {
    return [];
  }
  const lines: string[] = [];
  lines.push('binding: present');
  if (report.config !== undefined) {
    lines.push(`binding-project: ${report.config.projectName} (${report.config.projectId})`);
    lines.push(`binding-server: ${report.config.serverUrl}`);
  }
  lines.push(`binding-server-reachable: ${report.serverReachable ? 'yes' : 'no'}`);
  lines.push(`binding-token-valid: ${report.tokenValid ? 'yes' : 'no'}`);
  lines.push(`binding-project-exists: ${report.projectExists ? 'yes' : 'no'}`);
  lines.push(`binding-mcp-tools: ${String(report.mcpToolCount)}`);
  for (const issue of report.issues) {
    lines.push(`binding-issue: ${issue}`);
  }
  return lines;
}
