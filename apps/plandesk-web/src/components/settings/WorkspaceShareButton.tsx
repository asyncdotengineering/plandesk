import { CheckIcon, CopyIcon, Share2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, createWorkspaceShare } from '../../lib/api.js';

type WorkspaceShareButtonProps = {
  workspaceId: string;
  workspaceName: string;
};

export function WorkspaceShareButton({ workspaceId, workspaceName }: WorkspaceShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [audienceName, setAudienceName] = useState('');
  const [allowSubmit, setAllowSubmit] = useState(false);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setAudienceName('');
    setAllowSubmit(false);
    setResult(null);
    setCreateError(null);
    setCopied(false);
  };

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createWorkspaceShare(workspaceId, {
        audience_name: audienceName.trim(),
        mode: 'public',
        submit: allowSubmit,
      });
      setResult({ url: res.url });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setCreateError('Workspace not found.');
      } else {
        setCreateError("Couldn't create the share link. Please try again.");
      }
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      toast('Link copied');
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Share ${workspaceName} with a client`}
          data-workspace-share-trigger={workspaceId}
        >
          <Share2Icon className="size-3.5" /> Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{workspaceName}” with a client</DialogTitle>
          <DialogDescription>
            Create a portal link showing every project in this workspace. Read-only
            {allowSubmit ? ' with issue submission.' : '.'}
          </DialogDescription>
        </DialogHeader>

        {result === null ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="workspace-share-audience">Audience name</Label>
              <Input
                id="workspace-share-audience"
                type="text"
                placeholder="Client name"
                value={audienceName}
                onChange={(event) => {
                  setAudienceName(event.target.value);
                }}
              />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <span>Allow the client to submit issues</span>
              <input
                type="checkbox"
                checked={allowSubmit}
                onChange={(event) => {
                  setAllowSubmit(event.target.checked);
                }}
                className="size-4 accent-[var(--primary)]"
              />
            </label>
            <Button
              type="button"
              onClick={create}
              disabled={creating || audienceName.trim() === ''}
            >
              {creating ? 'Creating…' : 'Create link'}
            </Button>
          </div>
        ) : null}

        {createError !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {createError}
          </p>
        ) : null}

        {result !== null ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={result.url}
                className="mono text-xs"
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                aria-label="Copy link"
                onClick={copy}
              >
                {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can view this workspace&apos;s projects. Read-only.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
