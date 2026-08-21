import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { PrototypeCanvas } from '../components/prototypes/PrototypeCanvas.js';

/**
 * Chromeless canvas route — no sidebar, no breadcrumb topbar, no content
 * padding (see `isCanvasPath` in __root.tsx). The back link below is the way
 * out that the breadcrumb used to carry.
 */
function ProjectPrototypeCanvasPage() {
  const { id, prototypeId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <div className="h-dvh min-h-0 w-screen overflow-hidden">
      <PrototypeCanvas
        prototypeId={prototypeId}
        onPresent={(screenId) => {
          void navigate({
            to: '/projects/$id/prototypes/$prototypeId/present/$screenId',
            params: { id, prototypeId, screenId },
          });
        }}
        backSlot={
          <Link
            to="/projects/$id/prototypes"
            params={{ id }}
            aria-label="Back to prototypes"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Prototypes
          </Link>
        }
      />
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/prototypes/$prototypeId')({
  component: ProjectPrototypeCanvasPage,
});
