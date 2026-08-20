import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PortalShareGate } from '@/components/portal/PortalShareGate.js';
import { portalPrototypeToCanvas } from '@/components/portal/PortalPrototypeCanvas.js';
import { PresentStage } from '@/components/prototypes/PresentStage.js';

/**
 * Preview mode on a share link. This is the surface the link exists for: a
 * client asked to review a flow wants to walk it, not to read a node graph.
 */
function PortalPresentPage() {
  const { shareToken, prototypeId, screenId } = Route.useParams();
  const navigate = useNavigate();

  return (
    <PortalShareGate shareToken={shareToken}>
      {(view) => {
        const prototype = view.prototypes?.find((candidate) => candidate.id === prototypeId);
        if (prototype === undefined) {
          return <p className="p-6 text-sm text-muted-foreground">Prototype not found.</p>;
        }
        return (
          <div className="h-screen w-screen overflow-hidden">
            <PresentStage
              prototype={portalPrototypeToCanvas(prototype, view.project.id)}
              screenId={screenId}
              frameToken={shareToken}
              onGoToScreen={(next) => {
                void navigate({
                  to: '/p/$shareToken/prototypes/$prototypeId/present/$screenId',
                  params: { shareToken, prototypeId, screenId: next },
                });
              }}
              onExit={() => {
                void navigate({
                  to: '/p/$shareToken/prototypes/$prototypeId',
                  params: { shareToken, prototypeId },
                });
              }}
            />
          </div>
        );
      }}
    </PortalShareGate>
  );
}

export const Route = createFileRoute('/p/$shareToken/prototypes/$prototypeId_/present/$screenId')({
  component: PortalPresentPage,
});
