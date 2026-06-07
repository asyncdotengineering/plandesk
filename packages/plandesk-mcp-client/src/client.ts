import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_URL = 'http://127.0.0.1:3847';

export type PlandeskProject = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskStatusSummary = Record<string, number>;

export type PlandeskProjectDetail = PlandeskProject & {
  summary: TaskStatusSummary;
};

export type PlandeskClientOptions = {
  url?: string;
  token?: string;
};

export type PlandeskClient = {
  listProjects(): Promise<PlandeskProject[]>;
  getProject(id: string): Promise<PlandeskProjectDetail>;
  close(): Promise<void>;
};

type ToolCallResult = {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
};

function resolveBaseUrl(url?: string): string {
  const raw = url ?? process.env.PLANDESK_URL ?? DEFAULT_URL;
  return raw.replace(/\/$/, '');
}

function resolveToken(token?: string): string {
  const raw = token ?? process.env.PLANDESK_MCP_TOKEN;
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      'PLANDESK_MCP_TOKEN is required (pass token option or set the environment variable)',
    );
  }
  return raw.trim();
}

function mcpEndpoint(baseUrl: string): URL {
  return new URL(`${baseUrl}/mcp/`);
}

type TextContentBlock = {
  type: 'text';
  text: string;
};

function isTextContentBlock(item: unknown): item is TextContentBlock {
  return (
    typeof item === 'object' &&
    item !== null &&
    'type' in item &&
    item.type === 'text' &&
    'text' in item &&
    typeof item.text === 'string'
  );
}

function extractTextContent(result: ToolCallResult): string | undefined {
  if (!Array.isArray(result.content)) {
    return undefined;
  }
  for (const item of result.content) {
    if (isTextContentBlock(item)) {
      return item.text;
    }
  }
  return undefined;
}

function parseToolPayload(result: ToolCallResult): Record<string, unknown> {
  if (result.isError) {
    const message = extractTextContent(result);
    throw new Error(message ?? 'Plan Desk MCP tool returned an error');
  }

  if (result.structuredContent !== undefined && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }

  const text = extractTextContent(result);
  if (text === undefined) {
    throw new Error('Plan Desk MCP tool returned empty content');
  }

  return JSON.parse(text) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function wrapClientError(err: unknown, baseUrl: string, phase: 'connect' | 'call'): Error {
  if (err instanceof Error && err.message.includes('PLANDESK_MCP_TOKEN')) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('401') || lower.includes('unauthorized')) {
    return new Error(`Plan Desk MCP authentication failed (401) at ${baseUrl}/mcp/`);
  }

  if (
    lower.includes('econnrefused') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('enotfound') ||
    lower.includes('socket')
  ) {
    return new Error(`Plan Desk MCP server unreachable at ${baseUrl}/mcp/ (${message})`);
  }

  if (phase === 'connect') {
    return new Error(`Failed to connect to Plan Desk MCP at ${baseUrl}/mcp/: ${message}`);
  }

  return new Error(`Plan Desk MCP request failed: ${message}`);
}

export async function createPlandeskClient(
  options: PlandeskClientOptions = {},
): Promise<PlandeskClient> {
  const baseUrl = resolveBaseUrl(options.url);
  const token = resolveToken(options.token);

  const transport = new StreamableHTTPClientTransport(mcpEndpoint(baseUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const client = new Client({ name: 'plandesk-mcp-client', version: '0.0.0' });

  try {
    await client.connect(transport);
  } catch (err) {
    throw wrapClientError(err, baseUrl, 'connect');
  }

  return {
    async listProjects(): Promise<PlandeskProject[]> {
      try {
        const result = await client.callTool({ name: 'list_projects', arguments: {} });
        const payload = parseToolPayload(result as ToolCallResult);
        const projects = payload.projects;
        if (!Array.isArray(projects)) {
          throw new Error('Plan Desk list_projects response missing projects array');
        }
        return projects as PlandeskProject[];
      } catch (err) {
        throw wrapClientError(err, baseUrl, 'call');
      }
    },

    async getProject(id: string): Promise<PlandeskProjectDetail> {
      try {
        const result = await client.callTool({
          name: 'get_project',
          arguments: { project_id: id },
        });
        const payload = parseToolPayload(result as ToolCallResult);
        const project = payload.project;
        if (!isRecord(project) || typeof project.id !== 'string') {
          throw new Error('Plan Desk get_project response missing project');
        }
        return project as PlandeskProjectDetail;
      } catch (err) {
        throw wrapClientError(err, baseUrl, 'call');
      }
    },

    async close(): Promise<void> {
      await client.close();
    },
  };
}
