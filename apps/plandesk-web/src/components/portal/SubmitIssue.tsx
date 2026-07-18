import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';
import {
  PortalRateLimitedError,
  PortalSubmitFieldError,
  PortalSubmitForbiddenError,
  PortalUnauthorizedError,
  submitIssue,
  type PortalSubmission,
} from '../../lib/portal.js';

type SubmitIssueProps = {
  shareToken: string;
  sessionToken: string;
  tasks: { id: string; label: string }[];
  /** Target project for a workspace share; omitted for a project share. */
  projectId?: string;
  onSubmitted: (submission: PortalSubmission) => void;
  onUnauthorized: () => void;
};

const SEVERITY_OPTIONS = ['low', 'medium', 'high'] as const;

export function SubmitIssue({
  shareToken,
  sessionToken,
  tasks,
  projectId,
  onSubmitted,
  onUnauthorized,
}: SubmitIssueProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('');
  const [taskRef, setTaskRef] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !pending && permissionError === null;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setPending(true);
    setFieldError(null);
    setRateLimitError(null);
    setSuccessMessage(null);

    try {
      const submission = await submitIssue(shareToken, sessionToken, {
        title: trimmedTitle,
        body: body.trim() === '' ? undefined : body.trim(),
        severity: severity === '' ? undefined : severity,
        task_ref: taskRef.trim() === '' ? undefined : taskRef.trim(),
        ...(projectId !== undefined ? { project_id: projectId } : {}),
      });

      setTitle('');
      setBody('');
      setSeverity('');
      setTaskRef('');
      setExpanded(false);
      setSuccessMessage('Reported ✓');
      onSubmitted(submission);
    } catch (error) {
      if (error instanceof PortalUnauthorizedError) {
        onUnauthorized();
        return;
      }
      if (error instanceof PortalSubmitForbiddenError) {
        setPermissionError("You don't have permission to submit to this share.");
        return;
      }
      if (error instanceof PortalRateLimitedError) {
        setRateLimitError(error.message);
        return;
      }
      if (error instanceof PortalSubmitFieldError) {
        setFieldError(error.message);
        return;
      }
      setFieldError(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Report an issue" className="mb-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm font-semibold">Report an issue</CardTitle>
          {!expanded ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setExpanded(true);
              }}
            >
              Report an issue
            </Button>
          ) : null}
        </CardHeader>

        {successMessage !== null ? (
          <CardContent className="pt-0">
            <p role="status" className="text-sm font-semibold text-[var(--s-done-fg)]">
              {successMessage}
            </p>
          </CardContent>
        ) : null}

        {permissionError !== null ? (
          <CardContent className="pt-0">
            <p role="alert" className="text-sm text-destructive">
              {permissionError}
            </p>
          </CardContent>
        ) : null}

        {rateLimitError !== null ? (
          <CardContent className="pt-0">
            <p role="alert" className="text-sm text-destructive">
              {rateLimitError}
            </p>
          </CardContent>
        ) : null}

        {expanded ? (
          <CardContent>
            <form
              onSubmit={(event) => {
                void handleSubmit(event);
              }}
              className="grid gap-3.5"
            >
              <div className="grid gap-1.5">
                <Label htmlFor="issue-title">Title</Label>
                <Input
                  id="issue-title"
                  type="text"
                  name="title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                  required
                  disabled={pending}
                />
                {fieldError !== null ? (
                  <span role="alert" className="text-xs text-destructive">
                    {fieldError}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="issue-body">Description</Label>
                <Textarea
                  id="issue-body"
                  name="body"
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                  }}
                  rows={4}
                  disabled={pending}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="issue-severity">
                  Severity <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <select
                  id="issue-severity"
                  name="severity"
                  value={severity}
                  onChange={(event) => {
                    setSeverity(event.target.value);
                  }}
                  disabled={pending}
                  className={cn(
                    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none',
                    'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  <option value="">—</option>
                  {SEVERITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              {tasks.length > 0 ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="issue-task-ref">
                    Which part is this about?{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Select
                    value={taskRef}
                    onValueChange={setTaskRef}
                    disabled={pending || permissionError !== null}
                  >
                    <SelectTrigger id="issue-task-ref">
                      <SelectValue placeholder="Select a task" />
                    </SelectTrigger>
                    <SelectContent>
                      {tasks.map((task) => (
                        <SelectItem key={task.id} value={task.id}>
                          {task.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!canSubmit || permissionError !== null}>
                  {pending ? 'Submitting…' : 'Submit'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setExpanded(false);
                    setFieldError(null);
                    setRateLimitError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        ) : null}
      </Card>
    </section>
  );
}