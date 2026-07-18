import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCreateTask } from '../../lib/queries.js';

type FileIssueProps = {
  projectId: string;
};

const SEVERITY_OPTIONS = ['low', 'medium', 'high'] as const;

function buildDescription(body: string, severity: string): string | undefined {
  const trimmedBody = body.trim();
  const lines = [trimmedBody];
  if (severity !== '') {
    lines.push(`Severity: ${severity}`);
  }
  const description = lines.filter((line) => line !== '').join('\n\n');
  return description === '' ? undefined : description;
}

export function FileIssue({ projectId }: FileIssueProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('');
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const createTask = useCreateTask(projectId);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !createTask.isPending;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setAnnouncement(null);
    createTask.mutate(
      {
        label: trimmedTitle,
        description: buildDescription(body, severity) ?? null,
        status: 'backlog',
      },
      {
        onSuccess: () => {
          setTitle('');
          setBody('');
          setSeverity('');
          setExpanded(false);
          setAnnouncement('Filed ✓');
          toast.success('Filed ✓');
        },
      },
    );
  }

  return (
    <section
      aria-label="File an issue"
      className="mb-6 rounded-lg border border-border bg-muted/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">File an issue</h2>
        {!expanded ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setExpanded(true);
            }}
          >
            New issue
          </Button>
        ) : null}
      </div>

      {announcement !== null ? (
        <p role="status" className="sr-only">
          {announcement}
        </p>
      ) : null}

      {createTask.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Something went wrong. Please try again.
        </p>
      ) : null}

      {expanded ? (
        <form onSubmit={handleSubmit} className="mt-4 grid gap-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor="file-issue-title">Title</Label>
            <Input
              id="file-issue-title"
              type="text"
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              required
              disabled={createTask.isPending}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="file-issue-body">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="file-issue-body"
              name="body"
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              rows={4}
              disabled={createTask.isPending}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="file-issue-severity">
              Severity <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={severity === '' ? 'none' : severity}
              onValueChange={(value) => {
                setSeverity(value === 'none' ? '' : value);
              }}
              disabled={createTask.isPending}
            >
              <SelectTrigger id="file-issue-severity" className="w-full" aria-label="Severity">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {SEVERITY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!canSubmit}>
              {createTask.isPending ? 'Filing…' : 'File issue'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={createTask.isPending}
              onClick={() => {
                setExpanded(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}