import { PLANDESK_SKILL_TEMPLATE } from './skill-template.js';

export const PLANDESK_CONNECT_VERSION = 'plandesk-connect-v1';
export const SENTINEL_START = '<!-- plandesk:start -->';
export const SENTINEL_END = '<!-- plandesk:end -->';
export const SENTINEL_INCLUDE = '@.plandesk/skill.md';
export const TOKEN_ENV_VAR = 'PLANDESK_MCP_TOKEN';
export const GITIGNORE_TOKEN_LINE = '.plandesk/token';
export const MCP_SERVER_KEY = 'plandesk';

export type PlanDeskConfig = {
  version: typeof PLANDESK_CONNECT_VERSION;
  serverUrl: string;
  projectId: string;
  projectName: string;
};

export type McpJson = {
  mcpServers?: Record<
    string,
    {
      type: string;
      url: string;
      headers?: Record<string, string>;
    }
  >;
};

export function buildSentinelBlock(): string {
  return `${SENTINEL_START}\n${SENTINEL_INCLUDE}\n${SENTINEL_END}`;
}

export function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function buildMcpUrl(serverUrl: string): string {
  return `${normalizeServerUrl(serverUrl)}/mcp/`;
}

export function buildConfigJson(input: {
  serverUrl: string;
  projectId: string;
  projectName: string;
}): string {
  const config: PlanDeskConfig = {
    version: PLANDESK_CONNECT_VERSION,
    serverUrl: normalizeServerUrl(input.serverUrl),
    projectId: input.projectId,
    projectName: input.projectName,
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function parseConfigJson(content: string): PlanDeskConfig {
  const parsed = JSON.parse(content) as Partial<PlanDeskConfig>;
  if (parsed.version !== PLANDESK_CONNECT_VERSION) {
    throw new Error(`unsupported config version: ${String(parsed.version)}`);
  }
  if (
    typeof parsed.serverUrl !== 'string' ||
    typeof parsed.projectId !== 'string' ||
    typeof parsed.projectName !== 'string'
  ) {
    throw new Error('invalid config.json shape');
  }
  return {
    version: PLANDESK_CONNECT_VERSION,
    serverUrl: normalizeServerUrl(parsed.serverUrl),
    projectId: parsed.projectId,
    projectName: parsed.projectName,
  };
}

export function buildMcpServerEntry(serverUrl: string): NonNullable<McpJson['mcpServers']>[string] {
  return {
    type: 'http',
    url: buildMcpUrl(serverUrl),
    headers: {
      Authorization: `Bearer \${${TOKEN_ENV_VAR}}`,
    },
  };
}

export function mergeMcpJson(existingContent: string | undefined, serverUrl: string): string {
  let doc: McpJson = {};
  if (existingContent !== undefined && existingContent.trim() !== '') {
    doc = JSON.parse(existingContent) as McpJson;
  }
  const servers = doc.mcpServers ?? {};
  servers[MCP_SERVER_KEY] = buildMcpServerEntry(serverUrl);
  doc.mcpServers = servers;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function removeMcpServerEntry(existingContent: string): string | undefined {
  const doc = JSON.parse(existingContent) as McpJson;
  if (doc.mcpServers === undefined) {
    return existingContent;
  }
  const rest = Object.fromEntries(
    Object.entries(doc.mcpServers).filter(([key]) => key !== MCP_SERVER_KEY),
  );
  if (Object.keys(rest).length === 0) {
    return undefined;
  }
  doc.mcpServers = rest;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function insertSentinelBlock(content: string): string {
  const block = buildSentinelBlock();
  const startIdx = content.indexOf(SENTINEL_START);
  const endIdx = content.indexOf(SENTINEL_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx).replace(/\n+$/, '');
    const after = content.slice(endIdx + SENTINEL_END.length).replace(/^\n+/, '');
    const parts = [before, block, after].filter((part) => part.length > 0);
    return `${parts.join('\n\n')}\n`;
  }
  if (content.length === 0) {
    return `${block}\n`;
  }
  const base = content.replace(/\n+$/, '');
  return `${base}\n\n${block}\n`;
}

export function removeSentinelBlock(content: string): string | undefined {
  const startIdx = content.indexOf(SENTINEL_START);
  const endIdx = content.indexOf(SENTINEL_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return content;
  }
  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + SENTINEL_END.length);
  const trimmedBefore = before.replace(/\n+$/, '');
  const trimmedAfter = after.replace(/^\n+/, '');
  if (trimmedBefore.length === 0 && trimmedAfter.length === 0) {
    return undefined;
  }
  if (trimmedBefore.length === 0) {
    return `${trimmedAfter}\n`;
  }
  if (trimmedAfter.length === 0) {
    return `${trimmedBefore}\n`;
  }
  return `${trimmedBefore}\n\n${trimmedAfter}\n`;
}

export function appendGitignoreLine(content: string | undefined, line: string): string {
  const normalizedLine = line.trim();
  if (content === undefined || content.trim() === '') {
    return `${normalizedLine}\n`;
  }
  const lines = content.split('\n');
  if (lines.some((entry) => entry.trim() === normalizedLine)) {
    return content.endsWith('\n') ? content : `${content}\n`;
  }
  const suffix = content.endsWith('\n') ? '' : '\n';
  return `${content}${suffix}${normalizedLine}\n`;
}

export function buildSkillMarkdown(): string {
  return `${PLANDESK_SKILL_TEMPLATE}\n`;
}

export function buildCodexCommandMarkdown(): string {
  return `# Plan Desk

@.plandesk/skill.md
`;
}

export function committedPaths(repoDir: string): string[] {
  return [
    `${repoDir}/.plandesk/config.json`,
    `${repoDir}/.plandesk/skill.md`,
    `${repoDir}/.mcp.json`,
    `${repoDir}/CLAUDE.md`,
    `${repoDir}/AGENTS.md`,
    `${repoDir}/.codex/commands/plandesk.md`,
    `${repoDir}/.gitignore`,
  ];
}
