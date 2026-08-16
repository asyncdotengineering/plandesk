import type { FlowCoverage, SerializedPrototypeWithScreens } from '@/lib/api.js';
import type { ClientViewPrototype } from '@/lib/portal.js';
import { PrototypeCanvas } from '../prototypes/PrototypeCanvas.js';

const PORTAL_COVERAGE = {
  parseable: true,
  parse_error: null,
  planned: [],
  built: [],
  missing: [],
  unplanned: [],
  states_unverified: [],
  unplanned_note: null,
} satisfies FlowCoverage;

/**
 * Adapts the portal projection to the same renderer the authoring canvas uses.
 * The projection remains deliberately small: it supplies only a shared
 * prototype's frames, links, positions, and revision keys.
 */
export function portalPrototypeToCanvas(
  prototype: ClientViewPrototype,
  projectId: string,
): SerializedPrototypeWithScreens {
  return {
    id: prototype.id,
    project_id: projectId,
    name: prototype.name,
    viewport_width: prototype.viewport_width,
    viewport_height: prototype.viewport_height,
    folder_id: null,
    created_at: '',
    updated_at: '',
    screens: prototype.screens.map((screen) => ({
      id: screen.id,
      project_id: projectId,
      title: screen.title,
      kind: screen.kind === 'html' ? 'html' : 'markdown',
      content: screen.content,
      prototype_id: prototype.id,
      // A screen is never filed; it belongs to the prototype canvas.
      folder_id: null,
      x: screen.x,
      y: screen.y,
      revision_id: screen.revision_id,
      created_at: '',
      updated_at: '',
    })),
    links: prototype.links.map((link) => ({
      id: link.id,
      project_id: projectId,
      from_artifact_id: link.from_artifact_id,
      to_artifact_id: link.to_artifact_id,
      raw_target: link.raw_target,
    })),
    boundary_links: [],
    coverage: PORTAL_COVERAGE,
  };
}

export function PortalPrototypeCanvas({
  prototype,
  projectId,
  shareToken,
  sessionToken,
  canComment,
}: {
  prototype: ClientViewPrototype;
  projectId: string;
  shareToken: string;
  sessionToken: string;
  canComment: boolean;
}) {
  return (
    <PrototypeCanvas
      prototypeId={prototype.id}
      prototype={portalPrototypeToCanvas(prototype, projectId)}
      readOnly
      guestModes={canComment ? ['interact', 'comment'] : ['interact']}
      frameToken={shareToken}
      commentTargetForArtifact={(artifactId) => ({
        type: 'portal-artifact',
        id: artifactId,
        shareToken,
        sessionToken,
      })}
    />
  );
}
