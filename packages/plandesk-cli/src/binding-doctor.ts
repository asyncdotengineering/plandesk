import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  fetchServedDataDir,
  getBoundProjectId,
  normalizeServerUrl,
  readPlandeskConfig,
  readPlandeskToken,
  type AnyPlanDeskConfig,
} from './connect-artifacts.js';

export type BindingDoctorReport = {
  present: boolean;
  config?: AnyPlanDeskConfig;
  serverReachable: boolean;
  tokenValid: boolean;
  projectExists: boolean;
  mcpToolCount: number;
  /** Board the connected server actually serves, via /api/v1/health (REQ-A3b). */
  servedDataDir?: string;
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

export async function runBindingDoctor(
  repoDir: string,
  expectedDataDir?: string,
): Promise<BindingDoctorReport> {
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
  let servedDataDir: string | undefined;

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
    // Identity, not just liveness (REQ-A3b): a 200 does not mean it is the
    // board this repo expects — two boards can share a default port/host.
    servedDataDir = await fetchServedDataDir(config.serverUrl);
    if (
      expectedDataDir !== undefined &&
      servedDataDir !== undefined &&
      servedDataDir !== expectedDataDir
    ) {
      issues.push(
        `served board (${servedDataDir}) does not match expected board (${expectedDataDir})`,
      );
    }

    // Project existence via REST (loopback or bearer).
    const projectHeaders: Record<string, string> = {};
    if (token !== undefined) {
      projectHeaders.Authorization = `Bearer ${token}`;
    }
    const boundProjectId = getBoundProjectId(config);
    if (boundProjectId !== undefined) {
      const projectResponse = await fetch(`${config.serverUrl}/api/v1/projects/${boundProjectId}`, {
        headers: projectHeaders,
      });
      if (projectResponse.ok) {
        projectExists = true;
      } else if (projectResponse.status === 404) {
        issues.push(`bound project not found: ${boundProjectId}`);
      } else {
        issues.push(`project check failed with status ${String(projectResponse.status)}`);
      }
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
    servedDataDir,
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
    if (report.config.version === 'plandesk-connect-v2') {
      lines.push(`binding-workspace: ${report.config.workspaceName} (${report.config.workspaceId})`);
    } else {
      lines.push(`binding-project: ${report.config.projectName} (${report.config.projectId})`);
    }
    lines.push(`binding-server: ${report.config.serverUrl}`);
  }
  lines.push(`binding-server-reachable: ${report.serverReachable ? 'yes' : 'no'}`);
  lines.push(`binding-token-valid: ${report.tokenValid ? 'yes' : 'no'}`);
  lines.push(`binding-project-exists: ${report.projectExists ? 'yes' : 'no'}`);
  lines.push(`binding-mcp-tools: ${String(report.mcpToolCount)}`);
  if (report.servedDataDir !== undefined) {
    lines.push(`binding-served-data-dir: ${report.servedDataDir}`);
  }
  for (const issue of report.issues) {
    lines.push(`binding-issue: ${issue}`);
  }
  return lines;
}
