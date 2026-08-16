/**
 * The URL an HTML artifact is rendered from.
 *
 * Always a frame source, never inlined markup. The render route serves the
 * artifact under `htmlArtifactCsp` — `sandbox allow-scripts`, `default-src
 * 'none'`, `connect-src 'none'` — which is what lets a report keep its styles
 * and scripts without those reaching the board around it.
 *
 * `revisionId` is the cache-buster: a re-pushed artifact must not render from a
 * stale frame. `frameToken` scopes a read to a share link when there is no
 * session.
 */
export function artifactRenderSrc(
  artifactId: string,
  revisionId: string,
  frameToken?: string,
): string {
  const version = `v=${encodeURIComponent(revisionId)}`;
  if (frameToken !== undefined && frameToken !== '') {
    return `/api/v1/artifacts/${artifactId}/render?token=${encodeURIComponent(frameToken)}&${version}`;
  }
  return `/api/v1/artifacts/${artifactId}/render?${version}`;
}
