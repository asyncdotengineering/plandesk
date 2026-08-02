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

/**
 * Mounts an HTML artifact in a parent page framed exactly like the previewer
 * chrome: sandbox value from HTML_FRAME_SANDBOX, content via srcdoc.
 *
 * Prefer installing the message listener in the same evaluate that appends the
 * iframe (see smoke.spec.ts) so setContent cannot wipe the handler.
 */
export async function mountHtmlArtifactFrame(page: Page, htmlContent: string): Promise<void> {
  await page.evaluate(
    ({ html, sandbox }) => {
      const iframe = document.createElement('iframe');
      iframe.id = 'harness-proto-frame';
      iframe.setAttribute('sandbox', sandbox);
      iframe.srcdoc = html;
      document.body.appendChild(iframe);
    },
    { html: htmlContent, sandbox: HTML_FRAME_SANDBOX },
  );
}
