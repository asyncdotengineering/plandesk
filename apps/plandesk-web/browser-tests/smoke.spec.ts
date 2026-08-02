import { expect, test } from '@playwright/test';
import { HTML_FRAME_SANDBOX } from './fixtures/frame';
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
  expect(server.htmlContent).toContain("script-src 'unsafe-inline'");
  expect(server.markdownContent).toContain('Harness markdown');

  // Parent document first, then listen, then mount the frame — setContent would
  // wipe any listener installed beforehand.
  await page.setContent('<!doctype html><html><body></body></html>');

  const smoke = page.evaluate(
    ({ html, sandbox, expected }) =>
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
        iframe.srcdoc = html;
        document.body.appendChild(iframe);
      }),
    {
      html: server.htmlContent,
      sandbox: HTML_FRAME_SANDBOX,
      expected: SMOKE_MESSAGE,
    },
  );

  await expect(smoke).resolves.toEqual(SMOKE_MESSAGE);
});
