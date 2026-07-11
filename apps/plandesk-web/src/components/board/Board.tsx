import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type PatchTaskInput,
  type SerializedDocumentTree,
  type SerializedTag,
  type SerializedTask,
  type TaskStatus,
  taskStatuses,
} from '../../lib/api.js';
import {
  useCreateTask,
  useDeleteTask,
  useDocuments,
  usePatchTask,
  useTags,
} from '../../lib/queries.js';
import { boardColumnOrder, columnLabels, filterTasksByAnyTag, groupTasksByStatus, LANE_TAG_PREFIX } from './board-utils.js';
import { BoardColumn } from './BoardColumn.js';
import { TaskDrawer } from './TaskDrawer.js';
import { TaskCardPreview } from './TaskCard.js';
import { useBoardDnd } from './useBoardDnd.js';

type BoardProps = {
  projectId: string;
  tasks: SerializedTask[];
};

const LANE_OPTIONS = ['none', 'auto', 'approve', 'full'] as const;
type LaneOption = (typeof LANE_OPTIONS)[number];

export function Board({ projectId, tasks }: BoardProps) {
  const { data: projectTags } = useTags(projectId);
  const { data: documents } = useDocuments(projectId);

  const linkedDocTaskIds = useMemo(() => collectLinkedTaskIds(documents), [documents]);
  const linkedDocByTask = useMemo(() => mapLinkedDocByTask(documents), [documents]);

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [createForStatus, setCreateForStatus] = useState<TaskStatus | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  const visibleTasks = useMemo(
    () => filterTasksByAnyTag(tasks, selectedTagIds),
    [tasks, selectedTagIds],
  );
  const grouped = useMemo(() => groupTasksByStatus(visibleTasks), [visibleTasks]);

  const createTask = useCreateTask(projectId);
  const patchTask = usePatchTask();
  const deleteTaskHook = useDeleteTask();
  const { handleDragEnd } = useBoardDnd({ projectId, tasks });

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const activeTask =
    activeTaskId !== null ? tasks.find((task) => task.id === activeTaskId) : undefined;

  const drawerTask = drawerTaskId !== null ? tasks.find((task) => task.id === drawerTaskId) : undefined;
  const tagNames = (projectTags ?? []).map((tag) => tag.name);

  const toggleTagFilter = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

  const handleChangeStatus = (taskId: string, status: TaskStatus) => {
    patchTask.mutate(
      { id: taskId, input: { status } },
      { onSuccess: () => toast(`Status → ${columnLabels[status]}`) },
    );
  };

  const handleRequestDelete = (taskId: string) => {
    setDeleteTaskId(taskId);
  };

  const handleConfirmDelete = () => {
    if (deleteTaskId === null) {
      return;
    }
    const targetId = deleteTaskId;
    deleteTaskHook.mutate(
      { id: targetId, projectId },
      {
        onSuccess: () => {
          toast('Task deleted');
          if (drawerTaskId === targetId) {
            setDrawerTaskId(null);
          }
          setDeleteTaskId(null);
        },
      },
    );
  };

  const handleCreate = (input: { label: string; status: TaskStatus; lane: LaneOption }) => {
    const tags = input.lane !== 'none' ? [`${LANE_TAG_PREFIX}${input.lane}`] : undefined;
    createTask.mutate(
      { label: input.label, status: input.status, tags },
      {
        onSuccess: () => {
          toast(`Task created in ${columnLabels[input.status]}`);
          setCreateForStatus(null);
        },
      },
    );
  };

  // Add/remove send the FULL replacement tag-name set (server replace semantics).
  const handleAddTag = (name: string) => {
    if (drawerTask === undefined) {
      return;
    }
    const names = (drawerTask.tags ?? []).map((tag) => tag.name);
    if (names.includes(name)) {
      return;
    }
    patchTask.mutate({ id: drawerTask.id, input: { tags: [...names, name] } });
  };

  const handleRemoveTag = (name: string) => {
    if (drawerTask === undefined) {
      return;
    }
    const names = (drawerTask.tags ?? []).map((tag) => tag.name).filter((n) => n !== name);
    patchTask.mutate({ id: drawerTask.id, input: { tags: names } });
  };

  const handlePatch = (input: PatchTaskInput) => {
    if (drawerTask === undefined) {
      return;
    }
    patchTask.mutate({ id: drawerTask.id, input });
  };

  return (
    <div className="flex h-full flex-col">
      {projectTags !== undefined && projectTags.length > 0 ? (
        <div role="group" aria-label="Filter by tag" className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Filter:</span>
          {projectTags.map((tag) => (
            <FilterTagButton
              key={tag.id}
              tag={tag}
              selected={selectedTagIds.includes(tag.id)}
              onClick={() => {
                toggleTagFilter(tag.id);
              }}
            />
          ))}
          {selectedTagIds.length > 0 ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                setSelectedTagIds([]);
              }}
            >
              Clear filter
            </Button>
          ) : null}
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event: DragStartEvent) => {
          setActiveTaskId(String(event.active.id));
        }}
        onDragEnd={(event: DragEndEvent) => {
          handleDragEnd(event);
          setActiveTaskId(null);
        }}
        onDragCancel={() => {
          setActiveTaskId(null);
        }}
      >
        <div className="min-h-0 flex-1 overflow-x-auto pb-2">
          <div className="flex h-full items-start gap-3.5">
            {boardColumnOrder.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                tasks={grouped[status]}
                linkedDocTaskIds={linkedDocTaskIds}
                onOpenTask={setDrawerTaskId}
                onChangeStatus={handleChangeStatus}
                onRequestDelete={handleRequestDelete}
                onAddTask={setCreateForStatus}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask !== undefined ? (
            <TaskCardPreview task={activeTask} hasLinkedDoc={linkedDocTaskIds.has(activeTask.id)} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDrawer
        open={drawerTask !== undefined}
        task={drawerTask ?? null}
        linkedDoc={drawerTask !== undefined ? linkedDocByTask.get(drawerTask.id) : undefined}
        tagSuggestions={tagNames}
        isSaving={patchTask.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerTaskId(null);
          }
        }}
        onPatch={handlePatch}
        onChangeStatus={(status) => {
          if (drawerTask !== undefined) {
            handleChangeStatus(drawerTask.id, status);
          }
        }}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
      />

      <CreateTaskDialog
        open={createForStatus !== null}
        status={createForStatus ?? 'todo'}
        isCreating={createTask.isPending}
        onClose={() => {
          setCreateForStatus(null);
        }}
        onCreate={handleCreate}
      />

      <DeleteTaskDialog
        open={deleteTaskId !== null}
        isDeleting={deleteTaskHook.isPending}
        onClose={() => {
          setDeleteTaskId(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function FilterTagButton({
  tag,
  selected,
  onClick,
}: {
  tag: SerializedTag;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={selected ? 'default' : 'outline'}
      aria-pressed={selected}
      onClick={onClick}
    >
      {tag.color !== null ? (
        <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
      ) : null}
      {tag.name}
    </Button>
  );
}

type CreateTaskDialogProps = {
  open: boolean;
  status: TaskStatus;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (input: { label: string; status: TaskStatus; lane: LaneOption }) => void;
};

function CreateTaskDialog({ open, status, isCreating, onClose, onCreate }: CreateTaskDialogProps) {
  const [label, setLabel] = useState('');
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(status);
  const [lane, setLane] = useState<LaneOption>('none');

  // Re-seed the form whenever the dialog opens (possibly for a new column).
  useEffect(() => {
    if (open) {
      setLabel('');
      setTaskStatus(status);
      setLane('none');
    }
  }, [open, status]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Lands on the board — a human releases scope → todo.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-task-title">Task</Label>
            <Input
              id="new-task-title"
              value={label}
              placeholder="Verb Noun in Location…"
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="new-task-status">Status</Label>
              <Select
                value={taskStatus}
                onValueChange={(value) => {
                  setTaskStatus(value as TaskStatus);
                }}
              >
                <SelectTrigger id="new-task-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taskStatuses.map((option) => (
                    <SelectItem key={option} value={option}>
                      {columnLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-task-lane">Lane</Label>
              <Select value={lane} onValueChange={(value) => {
              setLane(value as LaneOption);
            }}>
                <SelectTrigger id="new-task-lane" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={label.trim() === '' || isCreating}
            onClick={() => {
              onCreate({ label: label.trim(), status: taskStatus, lane });
            }}
          >
            {isCreating ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DeleteTaskDialogProps = {
  open: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function DeleteTaskDialog({ open, isDeleting, onClose, onConfirm }: DeleteTaskDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete task?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={isDeleting} onClick={onConfirm}>
            {isDeleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function collectLinkedTaskIds(documents: SerializedDocumentTree[] | undefined): Set<string> {
  const ids = new Set<string>();
  if (documents === undefined) {
    return ids;
  }
  const walk = (nodes: SerializedDocumentTree[]) => {
    for (const node of nodes) {
      if (node.linked_task_id !== null) {
        ids.add(node.linked_task_id);
      }
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(documents);
  return ids;
}

function mapLinkedDocByTask(
  documents: SerializedDocumentTree[] | undefined,
): Map<string, SerializedDocumentTree> {
  const map = new Map<string, SerializedDocumentTree>();
  if (documents === undefined) {
    return map;
  }
  const walk = (nodes: SerializedDocumentTree[]) => {
    for (const node of nodes) {
      if (node.linked_task_id !== null) {
        map.set(node.linked_task_id, node);
      }
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(documents);
  return map;
}
