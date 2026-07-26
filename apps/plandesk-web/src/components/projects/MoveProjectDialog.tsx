import { useEffect, useState } from 'react';
import { ArrowRightLeftIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError, type SerializedProject } from '../../lib/api.js';
import { useAuthSession } from '../../lib/auth.js';
import { useMoveProject } from '../../lib/queries.js';

type WorkspaceOption = { id: string; name: string };

/**
 * Move a project to another workspace. Owner-only — hidden for everyone else,
 * matching the Members invite-card gating. The server re-checks authority.
 */
export function MoveProjectDialog({
  project,
  workspaces,
}: {
  project: SerializedProject;
  workspaces: WorkspaceOption[];
}) {
  const session = useAuthSession();
  const isOwner = session.data?.role === 'owner';
  const moveProject = useMoveProject();

  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');

  const candidates = workspaces.filter((workspace) => workspace.id !== project.workspace_id);

  useEffect(() => {
    if (open) {
      const firstCandidate = workspaces.find((workspace) => workspace.id !== project.workspace_id);
      setTargetId(firstCandidate?.id ?? '');
    }
  }, [open, project.workspace_id, workspaces]);

  if (!isOwner || candidates.length === 0) {
    return null;
  }

  async function handleMove() {
    if (targetId === '') {
      return;
    }
    try {
      await moveProject.mutateAsync({ projectId: project.id, workspaceId: targetId });
      setOpen(false);
      toast('Project moved');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You don't have permission to move this project.");
      } else {
        // Fall through to the global MutationCache toast.
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Move ${project.name} to another workspace`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <ArrowRightLeftIcon className="size-3.5" />
          <span className="sr-only">Move</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move project</DialogTitle>
          <DialogDescription>
            Move <span className="font-medium">{project.name}</span> to another workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger aria-label="Target workspace">
              <SelectValue placeholder="Select a workspace" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => {
              void handleMove();
            }}
            disabled={moveProject.isPending || targetId === ''}
          >
            {moveProject.isPending ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
