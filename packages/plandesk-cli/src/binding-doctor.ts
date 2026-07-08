import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  normalizeServerUrl,
  readPlandeskConfig,
  readPlandeskToken,
  type PlanDeskConfig,
} from './connect-artifacts.js';

export type BindingDoctorReport = {
  present: boolean;
  config?: PlanDeskConfig;
  serverReachable: boolean;
  tokenValid: boolean;
  projectExists: boolean;
  mcpToolCount: number;
  issues: string[];
};

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
  const issues: string[] = [];

  const config = readPlandeskConfig(repoDir);
  if (!config) {
    return {
      present: false,
      serverReachable: false,
      tokenValid: false,
      projectExists: false,
      mcpToolCount: 0,
      issues: [],
    };
  }

  const token = readPlandeskToken(repoDir);
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
    // Project existence: the REST GET tells us whether the running server knows
    // this project. It does NOT authenticate the MCP token, so it must never be
    // the source of `tokenValid`.
    const projectResponse = await fetch(`${config.serverUrl}/api/v1/projects/${config.projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (projectResponse.ok) {
      projectExists = true;
    } else if (projectResponse.status === 404) {
      issues.push(`bound project not found: ${config.projectId}`);
    } else {
      issues.push(`project check failed with status ${String(projectResponse.status)}`);
    }

    // Token validity: exercise the REAL authenticated MCP path against the
    // running server (verifyToken), not the open REST route. This is the only
    // signal that cannot report "valid" while live MCP requests 401 — e.g. when
    // the bound port is held by a different project's server.
    try {
      mcpToolCount = await listMcpTools(config.serverUrl, token);
      tokenValid = true;
      if (mcpToolCount === 0) {
        issues.push('MCP tools list is empty');
      }
    } catch (error) {
      tokenValid = false;
      const message = error instanceof Error ? error.message : String(error);
      if (/\b401\b/.test(message) || /unauthor/i.test(message)) {
        issues.push('token invalid or revoked');
      } else {
        issues.push('MCP authentication failed (server may be serving a different project)');
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
