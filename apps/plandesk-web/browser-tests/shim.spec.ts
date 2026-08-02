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

type FrameMsg = {
  kind?: string;
  text?: string;
  height?: number;
  target?: string;
  selector?: { mode?: string };
  rect?: unknown;
  directive?: string;
  blockedUri?: string;
};

async function openRenderFrame(page: Page, artifactId: string): Promise<Frame> {
  const renderUrl = artifactRenderUrl(server.baseUrl, artifactId);
  await page.setContent('<!doctype html><html><body></body></html>');
  const ready = page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('plandesk:ready timeout')), 5000);
        const inbox: FrameMsg[] = [];
        (window as unknown as { __shimInbox: FrameMsg[] }).__shimInbox = inbox;
        window.addEventListener('message', (event) => {
          const data = event.data as FrameMsg | null;
          if (data !== null && typeof data === 'object' && typeof data.kind === 'string') {
            inbox.push(data);
            if (data.kind === 'plandesk:ready') {
              window.clearTimeout(timer);
              resolve();
            }
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

function postMode(page: Page, mode: 'arrange' | 'interact' | 'comment'): Promise<void> {
  return page.evaluate((m) => {
    const iframe = document.getElementById('harness-proto-frame') as HTMLIFrameElement;
    iframe.contentWindow?.postMessage({ kind: 'plandesk:mode', mode: m }, '*');
  }, mode);
}

/** Collect navigate/selection messages produced while running `action`. */
async function collectNavOrSelection(
  page: Page,
  action: () => Promise<void>,
): Promise<FrameMsg[]> {
  const pending = page.evaluate(
    () =>
      new Promise<FrameMsg[]>((resolve) => {
        const got: FrameMsg[] = [];
        const timer = window.setTimeout(() => resolve(got), 700);
        window.addEventListener('message', (event) => {
          const data = event.data as FrameMsg;
          if (data?.kind === 'plandesk:navigate' || data?.kind === 'plandesk:selection') {
            got.push(data);
          }
        });
      }),
  );
  await action();
  return pending;
}

test('plandesk:ready text matches document.body.textContent and round-trips offsets', async ({
  page,
}) => {
  const id = await server.seedHtmlArtifact(
    'ready-text',
    '<!doctype html><html><body><p>Hello</p><p>World</p></body></html>',
  );
  const frame = await openRenderFrame(page, id);
  const ready = await page.evaluate(() => {
    const inbox = (window as unknown as { __shimInbox: FrameMsg[] }).__shimInbox ?? [];
    return inbox.find((m) => m.kind === 'plandesk:ready');
  });
  expect(ready?.kind).toBe('plandesk:ready');
  const bodyText = await frame.evaluate(() => document.body.textContent ?? '');
  expect(ready?.text).toBe(bodyText);
  expect(bodyText).toBe('HelloWorld');

  const rectMsg = await page.evaluate(
    () =>
      new Promise<FrameMsg>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('rect timeout')), 3000);
        window.addEventListener('message', (event) => {
          const data = event.data as FrameMsg;
          if (data?.kind === 'plandesk:rect') {
            window.clearTimeout(timer);
            resolve(data);
          }
        });
        const iframe = document.getElementById('harness-proto-frame') as HTMLIFrameElement;
        iframe.contentWindow?.postMessage({ kind: 'plandesk:highlight', start: 3, end: 8 }, '*');
      }),
  );
  expect(rectMsg.rect).not.toBeNull();
});

test('stale highlight offsets reply with rect null — never a clamped range', async ({ page }) => {
  const id = await server.seedHtmlArtifact('stale-hl', '<p>abc</p>');
  await openRenderFrame(page, id);
  const rectMsg = await page.evaluate(
    () =>
      new Promise<FrameMsg>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('rect timeout')), 3000);
        window.addEventListener('message', (event) => {
          const data = event.data as FrameMsg;
          if (data?.kind === 'plandesk:rect') {
            window.clearTimeout(timer);
            resolve(data);
          }
        });
        const iframe = document.getElementById('harness-proto-frame') as HTMLIFrameElement;
        iframe.contentWindow?.postMessage({ kind: 'plandesk:highlight', start: 0, end: 999 }, '*');
      }),
  );
  expect(rectMsg.rect).toBeNull();
});

test('mode branching both directions and interact default', async ({ page }) => {
  const id = await server.seedHtmlArtifact(
    'modes',
    `<!doctype html><html><body>
      <a id="nav" href="plandesk://artifact/Next">go</a>
    </body></html>`,
  );
  const frame = await openRenderFrame(page, id);

  // Default interact (no mode received): navigate, no selection
  const defaultGot = await collectNavOrSelection(page, () => frame.click('#nav'));
  expect(defaultGot.filter((m) => m.kind === 'plandesk:navigate')).toHaveLength(1);
  expect(defaultGot.filter((m) => m.kind === 'plandesk:selection')).toHaveLength(0);
  expect(defaultGot[0]?.target).toBe('plandesk://artifact/Next');

  await postMode(page, 'interact');
  const interactGot = await collectNavOrSelection(page, () => frame.click('#nav'));
  expect(interactGot.filter((m) => m.kind === 'plandesk:navigate')).toHaveLength(1);
  expect(interactGot.filter((m) => m.kind === 'plandesk:selection')).toHaveLength(0);

  await postMode(page, 'comment');
  const commentGot = await collectNavOrSelection(page, () => frame.click('#nav'));
  expect(commentGot.filter((m) => m.kind === 'plandesk:selection')).toHaveLength(1);
  expect(commentGot.filter((m) => m.kind === 'plandesk:navigate')).toHaveLength(0);
  expect(commentGot[0]?.selector?.mode).toBe('point');
});

test('ctrl+wheel is cancelled; plain wheel is not prevented by the shim', async ({ page }) => {
  const id = await server.seedHtmlArtifact(
    'wheel',
    `<!doctype html><html><body style="height:2000px"><p>tall</p></body></html>`,
  );
  const frame = await openRenderFrame(page, id);

  const ctrlResult = await frame.evaluate(() => {
    const ev = new WheelEvent('wheel', {
      deltaY: 40,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);
    return { defaultPrevented: ev.defaultPrevented };
  });
  expect(ctrlResult.defaultPrevented).toBe(true);

  const plainResult = await frame.evaluate(() => {
    const ev = new WheelEvent('wheel', {
      deltaY: 40,
      ctrlKey: false,
      metaKey: false,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);
    return { defaultPrevented: ev.defaultPrevented };
  });
  expect(plainResult.defaultPrevented).toBe(false);
});

test('runtime script-src violation posts plandesk:blocked', async ({ page }) => {
  const id = await server.seedHtmlArtifact(
    'blocked',
    `<!doctype html><html><body>
      <p>probe</p>
      <script>
        setTimeout(function () {
          var s = document.createElement('script');
          s.src = 'https://unpkg.com/x';
          document.body.appendChild(s);
        }, 0);
      </script>
    </body></html>`,
  );
  // Violation often fires during mount (setTimeout 0) — collect from the
  // inbox installed in openRenderFrame rather than a late listener.
  await openRenderFrame(page, id);
  await expect
    .poll(async () => {
      const inbox = await page.evaluate(() => {
        return (window as unknown as { __shimInbox: FrameMsg[] }).__shimInbox ?? [];
      });
      return inbox.find((m) => m.kind === 'plandesk:blocked') ?? null;
    })
    .toMatchObject({
      kind: 'plandesk:blocked',
      directive: expect.stringMatching(/script-src/),
      blockedUri: expect.stringContaining('unpkg.com'),
    });
});

test('title containing </script> still serves a functional shim', async ({ page }) => {
  const id = await server.seedHtmlArtifact(
    'hostile-title',
    `<!doctype html><html><head><title></script><script>window.__pwned=1</script></title></head>
     <body><a id="nav" href="plandesk://artifact/X">x</a></body></html>`,
  );
  const renderUrl = artifactRenderUrl(server.baseUrl, id);
  const res = await page.request.get(renderUrl);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain('plandesk:ready');
  const firstShimClose = body.indexOf('</script>');
  expect(firstShimClose).toBeGreaterThan(0);
  expect(body.slice(firstShimClose + '</script>'.length)).toContain(
    '</script><script>window.__pwned=1',
  );

  const frame = await openRenderFrame(page, id);
  const collect = collectNavOrSelection(page, () => frame.click('#nav'));
  await expect(collect).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'plandesk:navigate', target: 'plandesk://artifact/X' }),
    ]),
  );
});
