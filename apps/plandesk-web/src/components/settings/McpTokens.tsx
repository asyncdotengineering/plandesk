import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
    toast('Token created');
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
    toast('Token revoked');
  }

  const snippets = rawToken !== null ? connectionSnippet(rawToken) : null;

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold">Create token</CardTitle>
          <CardDescription>
            The raw token is shown once after creation. Copy it now — it cannot be retrieved later.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form
            onSubmit={(e) => {
              void handleCreate(e);
            }}
            className="flex gap-2"
          >
            <Input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="Token name (e.g. Claude Desktop)"
              aria-label="Token name"
              className="flex-1"
            />
            <Button type="submit" disabled={createMutation.isPending || name.trim() === ''}>
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
          {createMutation.isError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Failed to create token.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {rawToken !== null ? (
        <Card className="border-[var(--s-prog-dot)] bg-[var(--s-prog-bg)]">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-[var(--s-prog-fg)]">
              Copy your token now
            </CardTitle>
            <CardDescription className="text-[var(--s-prog-fg)]/80">
              This is the only time the raw token will be shown. Store it securely.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <code className="block break-all rounded-md border border-border bg-card px-3 py-2.5 font-mono text-xs">
              {rawToken}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                void handleCopy();
              }}
            >
              {copied ? 'Copied' : 'Copy token'}
            </Button>
            {snippets ? (
              <div className="mt-2 grid gap-3">
                <h3 className="text-sm font-semibold">Connection commands</h3>
                <p className="text-xs text-muted-foreground">
                  Use one of these to connect your MCP client:
                </p>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Claude</label>
                  <code className="block break-all rounded-md border border-border bg-card px-2.5 py-2 font-mono text-xs">
                    {snippets.claude}
                  </code>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Codex</label>
                  <code className="block break-all rounded-md border border-border bg-card px-2.5 py-2 font-mono text-xs">
                    {snippets.codex}
                  </code>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold">Tokens</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <p className="px-4 py-3 text-sm text-muted-foreground">Loading tokens…</p> : null}
          {error ? (
            <p role="alert" className="px-4 py-3 text-sm text-destructive">
              Failed to load tokens.
            </p>
          ) : null}
          {!isLoading && tokens.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No tokens yet. Create one above.</p>
          ) : null}
          {tokens.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id} className="border-b last:border-b-0">
                    <td className="px-4 py-2.5 font-medium">{token.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatDate(token.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      {token.revoked_at === null ? 'Active' : 'Revoked'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {token.revoked_at === null ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void handleRevoke(token.id);
                          }}
                          disabled={revokeMutation.isPending}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}