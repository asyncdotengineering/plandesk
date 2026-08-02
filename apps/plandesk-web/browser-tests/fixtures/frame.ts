import type { Page } from '@playwright/test';

/**
 * Mirrors sandboxForTarget for kind === 'html' in
 * packages/plandesk-cli/src/preview.tsx — scripts allowed, opaque origin
 * (no allow-same-origin).
 *
 * Sabotage target for the discriminative check: change this to '' (empty
 * sandbox) so scripts do not run and the smoke message never arrives.
 * Removing the attribute entirely would allow scripts and would not fail a
 * message-receipt assertion.
 */
export const HTML_FRAME_SANDBOX = 'allow-scripts';

export type MountHtmlArtifactFrameOptions = {
  /** Absolute render URL (`…/api/v1/artifacts/:id/render`). */
  renderUrl: string;
  sandbox?: string;
};

/**
 * Mounts a served HTML screen in a parent page the way the product will:
 * `sandbox` from HTML_FRAME_SANDBOX and `src` pointing at the render endpoint.
 *
 * Prefer installing the message listener in the same evaluate that appends the
 * iframe (see smoke.spec.ts) so setContent cannot wipe the handler.
 */
export async function mountHtmlArtifactFrame(
  page: Page,
  options: MountHtmlArtifactFrameOptions,
): Promise<void> {
  const sandbox = options.sandbox ?? HTML_FRAME_SANDBOX;
  await page.evaluate(
    ({ renderUrl, sandbox: sandboxValue }) => {
      const iframe = document.createElement('iframe');
      iframe.id = 'harness-proto-frame';
      iframe.setAttribute('sandbox', sandboxValue);
      iframe.src = renderUrl;
      document.body.appendChild(iframe);
    },
    { renderUrl: options.renderUrl, sandbox },
  );
}

/** Build the product render URL for a seeded HTML artifact. */
export function artifactRenderUrl(baseUrl: string, artifactId: string, revision?: string): string {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/artifacts/${artifactId}/render`;
  return revision === undefined ? url : `${url}?v=${encodeURIComponent(revision)}`;
}
