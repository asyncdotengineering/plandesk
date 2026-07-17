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
  // Local loopback connect writes no token; missing file is not an issue there.
  // Hosted connect always writes a scoped agent key — then missing is an issue.

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

  if (serverReachable) {
    // Project existence via REST (loopback or bearer).
    const projectHeaders: Record<string, string> = {};
    if (token !== undefined) {
      projectHeaders.Authorization = `Bearer ${token}`;
    }
    const projectResponse = await fetch(`${config.serverUrl}/api/v1/projects/${config.projectId}`, {
      headers: projectHeaders,
    });
    if (projectResponse.ok) {
      projectExists = true;
    } else if (projectResponse.status === 404) {
      issues.push(`bound project not found: ${config.projectId}`);
    } else {
      issues.push(`project check failed with status ${String(projectResponse.status)}`);
    }

    if (token !== undefined) {
      // Token validity: exercise the real authenticated MCP path.
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
    } else {
      // No token file: local loopback mode is valid when the project is reachable.
      tokenValid = projectExists;
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
