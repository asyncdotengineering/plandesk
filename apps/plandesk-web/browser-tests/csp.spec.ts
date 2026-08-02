import { expect, test, type Frame, type Page } from '@playwright/test';
import { artifactRenderUrl, HTML_FRAME_SANDBOX, mountHtmlArtifactFrame } from './fixtures/frame';
import { startHarnessServer, type HarnessServer } from './fixtures/server';

test.describe.configure({ mode: 'serial' });

let server: HarnessServer;

test.beforeAll(async () => {
  server = await startHarnessServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** Parent page + URL-mounted render frame; resolves after the stub posts ready. */
async function openRenderFrame(page: Page, artifactId: string): Promise<Frame> {
  const renderUrl = artifactRenderUrl(server.baseUrl, artifactId);
  await page.setContent('<!doctype html><html><body></body></html>');
  const ready = page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('plandesk:ready timeout')), 5000);
        window.addEventListener('message', (event) => {
          const data = event.data as { kind?: string } | null;
          if (data !== null && typeof data === 'object' && data.kind === 'plandesk:ready') {
            window.clearTimeout(timer);
            resolve();
          }
        });
      }),
  );
  await mountHtmlArtifactFrame(page, { renderUrl, sandbox: HTML_FRAME_SANDBOX });
  await ready;
  const frame = page.frames().find((f) => f.url().includes(`/artifacts/${artifactId}/render`));
  if (frame === undefined) {
    throw new Error(`render frame missing for ${artifactId}`);
  }
  return frame;
}

test('direct unframed navigation is sandboxed by the CSP sandbox directive', async ({ page }) => {
  const id = await server.seedHtmlArtifact(
    'direct-nav',
    '<!doctype html><html><body><p id="x">direct</p></body></html>',
  );
  const renderUrl = artifactRenderUrl(server.baseUrl, id);
  await page.goto(renderUrl);

  const cookieProbe = await page.evaluate(() => {
    try {
      const value = document.cookie;
      return { threw: false as const, value };
    } catch (error) {
      return {
        threw: true as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  // CSP `sandbox` without allow-same-origin → opaque origin.
  if (cookieProbe.threw) {
    expect(cookieProbe.threw).toBe(true);
  } else {
    expect(cookieProbe.value).toBe('');
  }

  const fetchProbe = await page.evaluate(async (apiUrl) => {
    try {
      await fetch(apiUrl);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }, `${server.baseUrl}/api/v1/health`);
  expect(fetchProbe.ok).toBe(false);
});

test('fetch to the API fails under connect-src none', async ({ page }) => {
  const id = await server.seedHtmlArtifact('vector-fetch', '<p>fetch</p>');
  const frame = await openRenderFrame(page, id);
  const result = await frame.evaluate(async (apiUrl) => {
    try {
      await fetch(apiUrl);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: String(error) };
    }
  }, `${server.baseUrl}/api/v1/health`);
  expect(result.ok).toBe(false);
});

test('XMLHttpRequest to the API fails under connect-src none', async ({ page }) => {
  const id = await server.seedHtmlArtifact('vector-xhr', '<p>xhr</p>');
  const frame = await openRenderFrame(page, id);
  const result = await frame.evaluate(
    (apiUrl) =>
      new Promise<{ ok: boolean }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', apiUrl);
        xhr.onload = () => resolve({ ok: true });
        xhr.onerror = () => resolve({ ok: false });
        try {
          xhr.send();
        } catch {
          resolve({ ok: false });
        }
      }),
    `${server.baseUrl}/api/v1/health`,
  );
  expect(result.ok).toBe(false);
});

test('WebSocket to the API origin fails under connect-src none', async ({ page }) => {
  const id = await server.seedHtmlArtifact('vector-ws', '<p>ws</p>');
  const frame = await openRenderFrame(page, id);
  const wsUrl = server.baseUrl.replace(/^http/, 'ws');
  const result = await frame.evaluate(
    (url) =>
      new Promise<{ ok: boolean }>((resolve) => {
        try {
          const ws = new WebSocket(url);
          ws.onopen = () => resolve({ ok: true });
          ws.onerror = () => resolve({ ok: false });
          window.setTimeout(() => resolve({ ok: false }), 2000);
        } catch {
          resolve({ ok: false });
        }
      }),
    wsUrl,
  );
  expect(result.ok).toBe(false);
});

test('form submission fails without allow-forms', async ({ page }) => {
  const id = await server.seedHtmlArtifact('vector-form', '<p>form</p>');
  const frame = await openRenderFrame(page, id);
  const before = frame.url();
  await frame.evaluate((action) => {
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = action;
    document.body.appendChild(form);
    form.submit();
  }, `${server.baseUrl}/api/v1/health`);
  // Sandbox without allow-forms blocks submission; the frame must stay on render.
  await expect.poll(() => frame.url(), { timeout: 2000 }).toBe(before);
  expect(frame.url()).toContain('/render');
});

test('top-level navigation via window.top.location fails without allow-top-navigation', async ({
  page,
}) => {
  const id = await server.seedHtmlArtifact('vector-top', '<p>top</p>');
  const frame = await openRenderFrame(page, id);
  const parentBefore = page.url();
  const result = await frame.evaluate(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      window.top!.location.href = 'http://example.com/';
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: String(error) };
    }
  });
  expect(result.ok).toBe(false);
  expect(page.url()).toBe(parentBefore);
  expect(page.url()).not.toContain('example.com');
});

test('own-frame location.href navigation succeeds (known unblockable hole)', async ({ page }) => {
  const id = await server.seedHtmlArtifact('vector-own-nav', '<p>own</p>');
  const frame = await openRenderFrame(page, id);
  // Spike observed both http://example.com/ and data: succeed; use data: so CI
  // does not depend on an external network. Do not invent a mitigation here.
  await frame.evaluate(() => {
    location.href = 'data:text/html,<h1>navigated</h1>';
  });
  await expect
    .poll(() => {
      const f = page.frames().find((fr) => fr !== page.mainFrame());
      return f?.url() ?? '';
    })
    .toMatch(/^data:text\/html/);
});

test('removing the meta CSP tag does not lift the applied policy', async ({ page }) => {
  const id = await server.seedHtmlArtifact(
    'meta-remove',
    '<!doctype html><html><body><p>meta</p></body></html>',
  );
  const frame = await openRenderFrame(page, id);
  const result = await frame.evaluate(async (apiUrl) => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const hadMeta = meta !== null;
    meta?.remove();
    const stillGone = document.querySelector('meta[http-equiv="Content-Security-Policy"]') === null;
    let fetchOk = false;
    try {
      await fetch(apiUrl);
      fetchOk = true;
    } catch {
      fetchOk = false;
    }
    return { hadMeta, stillGone, fetchOk };
  }, `${server.baseUrl}/api/v1/health`);
  expect(result.hadMeta).toBe(true);
  expect(result.stillGone).toBe(true);
  expect(result.fetchOk).toBe(false);
});
