import { createFileRoute } from '@tanstack/react-router';

function McpSettingsPage() {
  return (
    <section>
      <h1 style={{ marginTop: 0 }}>MCP Settings</h1>
      <p style={{ color: '#666' }}>MCP configuration UI (S4-02).</p>
    </section>
  );
}

export const Route = createFileRoute('/settings/mcp')({
  component: McpSettingsPage,
});
