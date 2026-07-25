import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCreateCliToken } from '../../lib/queries.js';
import { useAuthSession } from '../../lib/auth.js';
import { QueryFailure } from './QueryFailure.js';
import { ApiError } from '../../lib/api.js';

export function CliToken() {
  const session = useAuthSession();
  const createMutation = useCreateCliToken();
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    const created = await createMutation.mutateAsync(undefined);
    setRawToken(created.token);
    setCopied(false);
    toast('CLI token created');
  }

  async function handleCopy() {
    if (rawToken === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(rawToken);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
    }
  }

  if (session.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading session…</p>;
  }

  if (session.isError) {
    return (
      <QueryFailure
        message="Failed to load the current session."
        onRetry={() => {
          void session.refetch();
        }}
        isRetrying={session.isFetching}
      />
    );
  }

  if (session.data?.kind === 'loopback') {
    return (
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Local board access</CardTitle>
          <CardDescription>
            This board needs no CLI token: loopback is trusted as owner. Run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">plandesk connect</code> in the
            repository you want to connect.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let createError = 'Failed to generate CLI token. Try again.';
  if (createMutation.error instanceof ApiError) {
    if (createMutation.error.status === 401) {
      createError = 'Your session expired. Sign in again before creating a CLI token.';
    } else if (createMutation.error.status === 403) {
      createError = 'Only organization owners can create CLI tokens.';
    } else if (createMutation.error.status === 503) {
      createError = 'CLI token creation is not configured on this server.';
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold">CLI token</CardTitle>
          <CardDescription>
            Generate an org-wide owner token for the Plan Desk CLI. Paste it into{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">plandesk login</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Button
            type="button"
            onClick={() => {
              void handleGenerate();
            }}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Generating…' : 'Generate CLI token'}
          </Button>
          {createMutation.isError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {createError}
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
              You won&apos;t see this again. Store it securely, then run{' '}
              <code className="rounded bg-card/50 px-1 py-0.5 text-xs">plandesk login</code> and
              paste the token when prompted.
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
