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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createDocumentShare,
  createPrototypeShare,
  createTaskShare,
  type ShareLinkResult,
  type ShareTtl,
} from '@/lib/api';

type ShareResource = { kind: 'task' | 'document'; id: string } | { kind: 'prototype'; id: string };

export function ShareButton({ resource }: { resource: ShareResource }) {
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState<ShareTtl>('24h');
  const [allowSubmit, setAllowSubmit] = useState(false);
  const [result, setResult] = useState<ShareLinkResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setResult(null);
    setCreateError(null);
    setCopied(false);
  };

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res =
        resource.kind === 'task'
          ? await createTaskShare(resource.id, ttl)
          : resource.kind === 'document'
            ? await createDocumentShare(resource.id, ttl)
            : await createPrototypeShare(resource.id, ttl, allowSubmit);
      setResult(res);
    } catch {
      setCreateError("Couldn't create the share link. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const shareUrl = result !== null ? result.url || result.markdown_url : '';

  const copy = async () => {
    if (result === null) return;
    const link = result.url || result.markdown_url;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast('Link copied');
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
    }
  };

  const description =
    resource.kind === 'prototype'
      ? 'Create a public, read-only link that lets a client open this prototype canvas and click through its screens.'
      : resource.kind === 'task'
        ? 'Create a public, read-only link that renders this task as agent-ready Markdown — with its linked documents and images inlined.'
        : 'Create a public, read-only link that renders this document as agent-ready Markdown.';

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Share ${resource.kind}`}>
          <Share2Icon className="size-3.5" /> Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {resource.kind}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {result === null ? (
          <div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <span className="mb-1 block text-xs text-muted-foreground">Expires</span>
                <Select
                  value={ttl}
                  onValueChange={(value) => {
                    setTtl(value as ShareTtl);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">In 24 hours</SelectItem>
                    <SelectItem value="7d">In 7 days</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={() => {
                  void create();
                }}
                disabled={creating}
              >
                {creating ? 'Creating…' : 'Create link'}
              </Button>
            </div>
            {resource.kind === 'prototype' ? (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowSubmit}
                  onChange={(event) => {
                    setAllowSubmit(event.target.checked);
                  }}
                />
                Allow guests to leave anchored comments
              </label>
            ) : null}
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
                value={shareUrl}
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
                onClick={() => {
                  void copy();
                }}
              >
                {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can view it
              {result.expires_at !== null
                ? ` until ${new Date(result.expires_at).toLocaleString()}`
                : ' (no expiry)'}
              . Read-only.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
