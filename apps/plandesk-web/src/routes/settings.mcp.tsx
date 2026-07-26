import { useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CliToken } from '../components/settings/CliToken.js';
import { useAuthSession } from '../lib/auth.js';

function connectCommands(isLoopback: boolean): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (isLoopback) {
    return `plandesk connect --url ${origin}`;
  }
  return `plandesk login --server ${origin}\nplandesk connect --to <org>`;
}

function McpConnectCard({ isLoopback }: { isLoopback: boolean }) {
  const [copied, setCopied] = useState(false);
  const commands = connectCommands(isLoopback);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-sm font-semibold">Connect an agent (MCP)</CardTitle>
        <CardDescription>
          {isLoopback
            ? 'Connect a repository directly to this local board. No login or token is required.'
            : 'Point the Plan Desk CLI at this server, then connect it to your organization so agents can use the MCP tools.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        <code className="block whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 px-3 py-2.5 font-mono text-xs">
          {commands}
        </code>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => {
              void handleCopy();
            }}
          >
            {copied ? 'Copied' : 'Copy commands'}
          </Button>
          <a
            href="https://plandesk.asyncdot.com/connecting-agents/mcp-setup/"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            MCP setup docs
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function McpSettingsPage() {
  const { data: session } = useAuthSession();
  const isLoopback = session?.kind === 'loopback';

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight">MCP Settings</h2>
          <span className="text-xs text-muted-foreground">
            {isLoopback
              ? 'Connect agents directly to this trusted local board.'
              : 'Mint a CLI owner key for `plandesk login`, or connect agents with `plandesk connect`.'}
          </span>
        </div>
        <nav className="mb-6 flex flex-wrap gap-3 text-sm" aria-label="Settings sections">
          <Link
            to="/settings/members"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Members
          </Link>
          <Link
            to="/settings/workspaces"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Workspaces
          </Link>
          <Link to="/settings/mcp" className="font-medium text-foreground underline-offset-4">
            MCP / CLI token
          </Link>
        </nav>
        <McpConnectCard isLoopback={isLoopback} />
        <div className="mb-10">
          <CliToken />
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings/mcp')({
  component: McpSettingsPage,
});
