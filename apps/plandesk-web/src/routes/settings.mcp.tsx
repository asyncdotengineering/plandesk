import { createFileRoute } from '@tanstack/react-router';
import { McpTokens } from '../components/settings/McpTokens.js';

function McpSettingsPage() {
  return (
    <section>
      <h1 style={{ marginTop: 0 }}>MCP Settings</h1>
      <p style={{ color: '#666' }}>
        Create and manage MCP access tokens for external agents (Claude, Codex, etc.).
      </p>
      <McpTokens />
    </section>
  );
}

export const Route = createFileRoute('/settings/mcp')({
  component: McpSettingsPage,
});
