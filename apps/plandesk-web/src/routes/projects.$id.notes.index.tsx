import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { PenLineIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateNote, useNotes, useProject } from '../lib/queries.js';

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return String(minutes) + 'm ago';
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return String(hours) + 'h ago';
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return String(days) + 'd ago';
  }
  const weeks = Math.round(days / 7);
  return String(weeks) + 'w ago';
}

function noteBodyPreview(body: string | null): string {
  if (body === null || body.trim() === '') {
    return 'No body yet — start writing.';
  }
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? 'No body yet — start writing.' : text;
}

function ProjectNotesPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const { data: notes, isLoading: notesLoading, error: notesError } = useNotes(id);
  const createNote = useCreateNote(id);
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const handleCreate = () => {
    const trimmed = newTitle.trim();
    if (trimmed === '') {
      return;
    }
    createNote.mutate(
      { title: trimmed },
      {
        onSuccess: (note) => {
          setNewTitle('');
          setNewNoteOpen(false);
          toast('Note created');
          void navigate({
            to: '/projects/$id/notes/$noteId',
            params: { id, noteId: note.id },
          });
        },
      },
    );
  };

  if (projectLoading || notesLoading) {
    return <p className="text-sm text-muted-foreground">Loading notes…</p>;
  }

  if (projectError !== null) {
    return <p role="alert">Failed to load project: {projectError.message}</p>;
  }

  if (notesError !== null) {
    return <p role="alert">Failed to load notes: {notesError.message}</p>;
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight">Notes</h2>
          <span className="text-xs text-muted-foreground">
            Your working memory for this project — findings and scratch context, kept out of the
            formal plan. Open one to read or edit.
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setNewNoteOpen(true);
          }}
        >
          <PlusIcon className="size-3.5" />
          New note
        </Button>
      </div>

      <Dialog
        open={newNoteOpen}
        onOpenChange={(open) => {
          setNewNoteOpen(open);
          if (!open) {
            setNewTitle('');
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New note</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-note-title" className="text-xs text-muted-foreground">
                Title
              </Label>
              <Input
                id="new-note-title"
                autoFocus
                value={newTitle}
                placeholder="Note title"
                onChange={(event) => {
                  setNewTitle(event.target.value);
                }}
              />
            </div>
            {createNote.error !== null ? (
              <p role="alert" className="text-xs text-destructive">
                Failed to create note: {createNote.error.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewNoteOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createNote.isPending || newTitle.trim() === ''}>
                {createNote.isPending ? 'Creating…' : 'Create note'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {notes !== undefined && notes.length > 0 ? (
        <ul className="m-0 list-none space-y-2.5 p-0">
          {notes.map((note) => (
            <li key={note.id}>
              <Link
                to="/projects/$id/notes/$noteId"
                params={{ id, noteId: note.id }}
                className="flex items-start gap-3 rounded-[10px] border border-border bg-card p-3.5 shadow-[var(--shadow)] transition-colors hover:border-[var(--border-strong)]"
              >
                <div className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <PenLineIcon className="size-3.5" strokeWidth={1.7} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 text-[13px] font-semibold leading-snug">{note.title}</p>
                  <p className="m-0 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {noteBodyPreview(note.body)}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {relativeTime(note.updated_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No notes yet. Create one to capture working notes.
        </p>
      )}
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/notes/')({
  component: ProjectNotesPage,
});
