import { useState } from 'react';
import { useCreateMcpToken, useMcpTokens, useRevokeMcpToken } from '../../lib/queries.js';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function connectionSnippet(rawToken: string): { claude: string; codex: string } {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const header = `Authorization: Bearer ${rawToken}`;
  return {
    claude: `claude mcp add --transport http plandesk ${origin}/mcp/ --header "${header}"`,
    codex: `codex mcp add --transport http plandesk ${origin}/mcp/ --header "${header}"`,
  };
}

export function McpTokens() {
  const { data: tokens = [], isLoading, error } = useMcpTokens();
  const createMutation = useCreateMcpToken();
  const revokeMutation = useRevokeMcpToken();
  const [name, setName] = useState('');
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    const created = await createMutation.mutateAsync(trimmed);
    setRawToken(created.token);
    setCopied(false);
    setName('');
  }

  async function handleCopy() {
    if (rawToken === null) {
      return;
    }
    await navigator.clipboard.writeText(rawToken);
    setCopied(true);
  }

  async function handleRevoke(id: string) {
    await revokeMutation.mutateAsync(id);
    if (rawToken !== null) {
      setRawToken(null);
    }
  }

  const snippets = rawToken !== null ? connectionSnippet(rawToken) : null;

  return (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: '48rem' }}>
      <section>
        <h2 style={{ marginTop: 0, fontSize: '1.125rem' }}>Create token</h2>
        <p style={{ color: '#666', marginTop: 0 }}>
          The raw token is shown once after creation. Copy it now — it cannot be retrieved later.
        </p>
        <form
          onSubmit={(e) => {
            void handleCreate(e);
          }}
          style={{ display: 'flex', gap: '0.5rem' }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="Token name (e.g. Claude Desktop)"
            aria-label="Token name"
            style={{ flex: 1, padding: '0.5rem 0.75rem' }}
          />
          <button type="submit" disabled={createMutation.isPending || name.trim() === ''}>
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </form>
        {createMutation.isError ? (
          <p role="alert" style={{ color: '#b00020' }}>
            Failed to create token.
          </p>
        ) : null}
      </section>

      {rawToken !== null ? (
        <section
          style={{
            padding: '1rem',
            border: '1px solid #f0c36d',
            borderRadius: '6px',
            background: '#fffbeb',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: '1.125rem' }}>Copy your token now</h2>
          <p style={{ color: '#666', marginTop: 0 }}>
            This is the only time the raw token will be shown. Store it securely.
          </p>
          <code
            style={{
              display: 'block',
              padding: '0.75rem',
              background: '#fff',
              border: '1px solid #e5e5e5',
              borderRadius: '4px',
              wordBreak: 'break-all',
              fontSize: '0.875rem',
            }}
          >
            {rawToken}
          </code>
          <button
            type="button"
            onClick={() => {
              void handleCopy();
            }}
            style={{ marginTop: '0.75rem' }}
          >
            {copied ? 'Copied' : 'Copy token'}
          </button>
          {snippets ? (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Connection commands</h3>
              <p style={{ color: '#666', fontSize: '0.875rem', marginTop: 0 }}>
                Use one of these to connect your MCP client:
              </p>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#666' }}>Claude</label>
              <code
                style={{
                  display: 'block',
                  padding: '0.5rem',
                  background: '#fff',
                  border: '1px solid #e5e5e5',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  wordBreak: 'break-all',
                  marginBottom: '0.75rem',
                }}
              >
                {snippets.claude}
              </code>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#666' }}>Codex</label>
              <code
                style={{
                  display: 'block',
                  padding: '0.5rem',
                  background: '#fff',
                  border: '1px solid #e5e5e5',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  wordBreak: 'break-all',
                }}
              >
                {snippets.codex}
              </code>
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 style={{ marginTop: 0, fontSize: '1.125rem' }}>Tokens</h2>
        {isLoading ? <p>Loading tokens…</p> : null}
        {error ? (
          <p role="alert" style={{ color: '#b00020' }}>
            Failed to load tokens.
          </p>
        ) : null}
        {!isLoading && tokens.length === 0 ? (
          <p style={{ color: '#666' }}>No tokens yet. Create one above.</p>
        ) : null}
        {tokens.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5' }}>
                <th style={{ padding: '0.5rem 0' }}>Name</th>
                <th style={{ padding: '0.5rem 0' }}>Created</th>
                <th style={{ padding: '0.5rem 0' }}>Status</th>
                <th style={{ padding: '0.5rem 0' }} />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '0.5rem 0' }}>{token.name}</td>
                  <td style={{ padding: '0.5rem 0', color: '#666' }}>
                    {formatDate(token.created_at)}
                  </td>
                  <td style={{ padding: '0.5rem 0' }}>
                    {token.revoked_at === null ? 'Active' : 'Revoked'}
                  </td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right' }}>
                    {token.revoked_at === null ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRevoke(token.id);
                        }}
                        disabled={revokeMutation.isPending}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
