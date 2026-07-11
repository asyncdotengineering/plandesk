import { createFileRoute } from '@tanstack/react-router';
import { McpTokens } from '../components/settings/McpTokens.js';

function McpSettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight">MCP Settings</h2>
          <span className="text-xs text-muted-foreground">
            Create and manage MCP access tokens for external agents (Claude, Codex, etc.).
          </span>
        </div>
        <McpTokens />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings/mcp')({
  component: McpSettingsPage,
});