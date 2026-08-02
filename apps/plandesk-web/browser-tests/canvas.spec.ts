import { expect, test, type Page } from '@playwright/test';
import { startHarnessServer, type HarnessServer } from './fixtures/server';

test.describe.configure({ mode: 'serial' });

let server: HarnessServer;

test.beforeAll(async () => {
  server = await startHarnessServer();
});

test.afterAll(async () => {
  await server.stop();
});

const READY_HTML = (label: string) => `<!doctype html>
<html><body>
<p id="label">${label}</p>
<script>
parent.postMessage({ kind: 'plandesk:ready', label: ${JSON.stringify(label)} }, '*');
</script>
</body></html>`;

async function openPrototypeCanvas(page: Page, prototypeId: string): Promise<void> {
  await page.goto(`${server.baseUrl}/projects/${server.projectId}/prototypes/${prototypeId}`);
  await page.waitForSelector('[data-prototype-canvas]', { timeout: 15_000 });
}

test('system lays out new screens in nav order without client coordinates', async () => {
  const proto = await server.seedPrototype('Nav layout', 390, 844);
  const home = await server.seedPrototypeScreen(
    proto.id,
    'Home',
    `<!doctype html><html><body><a href="plandesk://artifact/Pay">Pay</a></body></html>`,
  );
  const pay = await server.seedPrototypeScreen(
    proto.id,
    'Pay',
    `<!doctype html><html><body><p>Pay</p></body></html>`,
  );

  // Create body must not have sent x/y — response carries system positions.
  expect(home.x).not.toBeNull();
  expect(home.y).not.toBeNull();
  expect(pay.x).not.toBeNull();
  expect(pay.y).not.toBeNull();
  expect(pay.y ?? 0).toBeGreaterThan(home.y ?? 0);

  const fetched = await server.getPrototype(proto.id);
  const homeRow = fetched.screens.find((s) => s.id === home.id);
  const payRow = fetched.screens.find((s) => s.id === pay.id);
  expect(homeRow?.y ?? 0).toBeLessThan(payRow?.y ?? 0);
});

test('null-target link renders a visibly broken stub on the source node', async ({ page }) => {
  const proto = await server.seedPrototype('Broken link', 390, 844);
  await server.seedPrototypeScreen(
    proto.id,
    'Start',
    `<!doctype html><html><body><a href="plandesk://artifact/DoesNotExist">go</a></body></html>`,
  );

  await openPrototypeCanvas(page, proto.id);
  const stub = page.locator('[data-broken-links]');
  await expect(stub).toBeVisible();
  await expect(stub).toContainText('DoesNotExist');
});

test('every screen node uses the prototype viewport dimensions', async ({ page }) => {
  const proto = await server.seedPrototype('Viewport size', 390, 844);
  await server.seedPrototypeScreen(proto.id, 'A', READY_HTML('A'));
  await server.seedPrototypeScreen(proto.id, 'B', READY_HTML('B'));

  await openPrototypeCanvas(page, proto.id);
  const canvas = page.locator('[data-prototype-canvas]');
  await expect(canvas).toHaveAttribute('data-viewport-width', '390');
  await expect(canvas).toHaveAttribute('data-viewport-height', '844');

  const nodes = page.locator('[data-screen-node]');
  await expect(nodes).toHaveCount(2);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-screen-node]')].map((el) => ({
      w: el.style.width,
      h: el.style.height,
    })),
  );
  expect(sizes).toEqual([
    { w: '390px', h: '844px' },
    { w: '390px', h: '844px' },
  ]);
});

test('off-screen screen does not execute until panned into view', async ({ page }) => {
  const proto = await server.seedPrototype('Cull', 390, 844);
  const near = await server.seedPrototypeScreen(proto.id, 'Near', READY_HTML('near'));
  const far = await server.seedPrototypeScreen(proto.id, 'Far', READY_HTML('far'));
  // Push far screen well outside the default viewport.
  await server.patchArtifact(far.id, { x: 20_000, y: 0 });

  const readyLabels: string[] = [];
  await page.exposeFunction('__harnessPushReady', (label: string) => {
    readyLabels.push(label);
  });

  await page.addInitScript(() => {
    window.addEventListener('message', (event) => {
      const data = event.data as { kind?: string; label?: string };
      if (data?.kind === 'plandesk:ready' && typeof data.label === 'string') {
        void (window as unknown as { __harnessPushReady: (l: string) => void }).__harnessPushReady(
          data.label,
        );
      }
    });
  });

  await openPrototypeCanvas(page, proto.id);

  // Near should mount; far should be culled (no frame) until panned in.
  await expect(page.locator(`[data-artifact-id="${near.id}"][data-screen-frame]`)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(`[data-artifact-id="${far.id}"][data-screen-frame]`)).toHaveCount(0);

  await expect.poll(() => readyLabels.includes('near'), { timeout: 8_000 }).toBe(true);
  expect(readyLabels.includes('far')).toBe(false);

  // Pan the far node into view via React Flow pane drag.
  const pane = page.locator('.react-flow__pane');
  const box = await pane.boundingBox();
  if (box === null) {
    throw new Error('react-flow pane missing');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 9000, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();

  await expect(page.locator(`[data-artifact-id="${far.id}"][data-screen-frame]`)).toBeVisible({
    timeout: 10_000,
  });
  await expect.poll(() => readyLabels.includes('far'), { timeout: 8_000 }).toBe(true);
});

test('synthetic postMessage from an unregistered source is dropped', async ({ page }) => {
  const proto = await server.seedPrototype('Registry', 390, 844);
  await server.seedPrototypeScreen(proto.id, 'Only', READY_HTML('only'));

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator('[data-screen-frame]')).toBeVisible({ timeout: 10_000 });

  // Wait until at least one accepted frame message (ready from the real iframe).
  await expect
    .poll(
      async () =>
        page.locator('[data-prototype-canvas]').getAttribute('data-accepted-frame-messages'),
      { timeout: 8_000 },
    )
    .not.toBe('0');

  const before = await page
    .locator('[data-prototype-canvas]')
    .getAttribute('data-accepted-frame-messages');

  await page.evaluate(() => {
    window.postMessage({ kind: 'plandesk:ready', label: 'spoof' }, '*');
  });
  // Give the listener a turn.
  await page.waitForTimeout(200);

  const after = await page
    .locator('[data-prototype-canvas]')
    .getAttribute('data-accepted-frame-messages');
  expect(after).toBe(before);
});

test('updating content remounts the frame within one poll interval', async ({ page }) => {
  const proto = await server.seedPrototype('Revision', 390, 844);
  const screen = await server.seedPrototypeScreen(proto.id, 'Rev', READY_HTML('v1'));

  await openPrototypeCanvas(page, proto.id);
  const frame = page.locator(`[data-artifact-id="${screen.id}"][data-screen-frame]`);
  await expect(frame).toBeVisible({ timeout: 10_000 });
  const srcBefore = await frame.getAttribute('src');
  expect(srcBefore).toContain(`v=${encodeURIComponent(screen.revision_id)}`);

  const updated = await server.patchArtifact(screen.id, {
    content: READY_HTML('v2'),
  });
  expect(updated.revision_id).not.toBe(screen.revision_id);

  // liveQueryOptions polls at 2500ms — allow one interval + buffer.
  await expect
    .poll(
      async () => {
        const node = page.locator(`[data-screen-node][data-artifact-id="${screen.id}"]`);
        return node.getAttribute('data-revision-id');
      },
      { timeout: 5_000 },
    )
    .toBe(updated.revision_id);

  await expect(frame).toHaveAttribute(
    'src',
    new RegExp(`v=${encodeURIComponent(updated.revision_id)}`),
  );
});
