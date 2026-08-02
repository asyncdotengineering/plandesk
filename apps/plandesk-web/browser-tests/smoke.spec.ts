import { expect, test } from '@playwright/test';
import { artifactRenderUrl, HTML_FRAME_SANDBOX, mountHtmlArtifactFrame } from './fixtures/frame';
import { SMOKE_MESSAGE, startHarnessServer, type HarnessServer } from './fixtures/server';

test.describe.configure({ mode: 'serial' });

let server: HarnessServer;

test.beforeAll(async () => {
  server = await startHarnessServer();
});

test.afterAll(async () => {
  await server.stop();
});

test('HTML artifact framed with allow-scripts posts a message the harness observes', async ({
  page,
}) => {
  expect(server.markdownContent).toContain('Harness markdown');

  const renderUrl = artifactRenderUrl(server.baseUrl, server.htmlArtifactId);
  const renderRes = await page.request.get(renderUrl);
  expect(renderRes.status()).toBe(200);
  const csp = renderRes.headers()['content-security-policy'] ?? '';
  expect(csp.startsWith('sandbox allow-scripts;')).toBe(true);
  expect(csp).toContain("script-src 'unsafe-inline'");
  expect(csp).toContain(server.baseUrl);

  // Parent document first, then listen, then mount the frame — setContent would
  // wipe any listener installed beforehand.
  await page.setContent('<!doctype html><html><body></body></html>');

  const smoke = page.evaluate(
    ({ url, sandbox, expected }) =>
      new Promise<typeof expected>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          reject(new Error('smoke message not received within 5000ms'));
        }, 5000);
        window.addEventListener('message', (event) => {
          const data = event.data as Partial<typeof expected> | null;
          if (
            data !== null &&
            typeof data === 'object' &&
            data.source === expected.source &&
            data.kind === expected.kind &&
            data.ok === expected.ok
          ) {
            window.clearTimeout(timer);
            resolve(data as typeof expected);
          }
        });
        const iframe = document.createElement('iframe');
        iframe.id = 'harness-proto-frame';
        iframe.setAttribute('sandbox', sandbox);
        iframe.src = url;
        document.body.appendChild(iframe);
      }),
    {
      url: renderUrl,
      sandbox: HTML_FRAME_SANDBOX,
      expected: SMOKE_MESSAGE,
    },
  );

  await expect(smoke).resolves.toEqual(SMOKE_MESSAGE);
});

test('mountHtmlArtifactFrame is the shared URL mounting primitive', async ({ page }) => {
  await page.setContent('<!doctype html><html><body></body></html>');
  const ready = page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('ready not received')), 5000);
        window.addEventListener('message', (event) => {
          const data = event.data as { kind?: string } | null;
          if (data !== null && typeof data === 'object' && data.kind === 'plandesk:ready') {
            window.clearTimeout(timer);
            resolve(true);
          }
        });
      }),
  );
  await mountHtmlArtifactFrame(page, {
    renderUrl: artifactRenderUrl(server.baseUrl, server.htmlArtifactId),
  });
  await expect(ready).resolves.toBe(true);
});
