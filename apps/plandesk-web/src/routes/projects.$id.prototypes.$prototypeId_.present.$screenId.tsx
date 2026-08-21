import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PresentStage } from '../components/prototypes/PresentStage.js';
import { usePrototype } from '../lib/queries.js';

/**
 * Preview mode for one screen of a prototype.
 *
 * Deliberately NOT nested under the canvas route (the `_` suffix opts out):
 * preview replaces the canvas rather than layering on it, and a nested route
 * would keep the canvas mounted with every frame in it live underneath.
 */
function ProjectPresentPage() {
  const { id, prototypeId, screenId } = Route.useParams();
  const navigate = useNavigate();
  const { data: prototype, isLoading, error } = usePrototype(prototypeId);

  const exit = () => {
    void navigate({
      to: '/projects/$id/prototypes/$prototypeId',
      params: { id, prototypeId },
    });
  };

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }
  if (error) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        Failed to load prototype: {error.message}
      </p>
    );
  }
  if (prototype === undefined) {
    return <p className="p-6 text-sm text-muted-foreground">Prototype not found.</p>;
  }

  return (
    <div className="h-dvh w-screen overflow-hidden">
      <PresentStage
        prototype={prototype}
        screenId={screenId}
        onGoToScreen={(next) => {
          void navigate({
            to: '/projects/$id/prototypes/$prototypeId/present/$screenId',
            params: { id, prototypeId, screenId: next },
          });
        }}
        onExit={exit}
      />
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/prototypes/$prototypeId_/present/$screenId')({
  component: ProjectPresentPage,
});
