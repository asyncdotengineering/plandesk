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

test('Arrange is default and body drag moves the node; Interact blocks drag', async ({ page }) => {
  const proto = await server.seedPrototype('Modes drag', 390, 844);
  const screen = await server.seedPrototypeScreen(
    proto.id,
    'DragMe',
    `<!doctype html><html><body>
      <p id="label">drag body</p>
      <button id="hit">hit</button>
      <script>parent.postMessage({ kind: 'plandesk:ready', label: 'drag' }, '*');</script>
    </body></html>`,
  );

  await openPrototypeCanvas(page, proto.id);
  const canvas = page.locator('[data-prototype-canvas]');
  await expect(canvas).toHaveAttribute('data-canvas-mode', 'arrange');
  await expect(page.locator('[data-mode-selector]')).toBeVisible();

  const frame = page.locator(`[data-screen-frame][data-artifact-id="${screen.id}"]`);
  await expect(frame).toBeVisible({ timeout: 10_000 });
  await expect(frame).toHaveAttribute('data-pointer-events', 'none');

  const node = page.locator(`[data-screen-node][data-artifact-id="${screen.id}"]`);
  const before = await node.boundingBox();
  if (before === null) {
    throw new Error('node box missing');
  }
  // Drag from the screen body (below the title strip), not the ~15px title.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 140, before.y + before.height * 0.55 + 90, {
    steps: 12,
  });
  await page.mouse.up();

  const afterArrange = await node.boundingBox();
  if (afterArrange === null) {
    throw new Error('node box missing after arrange drag');
  }
  const moved = Math.abs(afterArrange.x - before.x) + Math.abs(afterArrange.y - before.y);
  expect(moved).toBeGreaterThan(50);

  await page.locator('[data-mode="interact"]').click();
  await expect(canvas).toHaveAttribute('data-canvas-mode', 'interact');
  await expect(frame).toHaveAttribute('data-pointer-events', 'auto');

  const mid = await node.boundingBox();
  if (mid === null) {
    throw new Error('node box missing before interact drag');
  }
  await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(mid.x + mid.width / 2 + 140, mid.y + mid.height * 0.55 + 90, {
    steps: 12,
  });
  await page.mouse.up();

  const afterInteract = await node.boundingBox();
  if (afterInteract === null) {
    throw new Error('node box missing after interact drag');
  }
  const interactMoved = Math.abs(afterInteract.x - mid.x) + Math.abs(afterInteract.y - mid.y);
  expect(interactMoved).toBeLessThan(20);

  // Click reaches the frame in Interact (button receives the click).
  const hit = page
    .frameLocator(`[data-screen-frame][data-artifact-id="${screen.id}"]`)
    .locator('#hit');
  await hit.click();
});

test('mode switch does not remount the frame (ready posts once)', async ({ page }) => {
  const proto = await server.seedPrototype('Mode remount', 390, 844);
  await server.seedPrototypeScreen(proto.id, 'Once', READY_HTML('once'));

  const readyLabels: string[] = [];
  await page.exposeFunction('__harnessPushReadyMode', (label: string) => {
    readyLabels.push(label);
  });
  await page.addInitScript(() => {
    window.addEventListener('message', (event) => {
      const data = event.data as { kind?: string; label?: string };
      if (data?.kind === 'plandesk:ready' && typeof data.label === 'string') {
        void (
          window as unknown as { __harnessPushReadyMode: (l: string) => void }
        ).__harnessPushReadyMode(data.label);
      }
    });
  });

  await openPrototypeCanvas(page, proto.id);
  await expect
    .poll(() => readyLabels.filter((l) => l === 'once').length, { timeout: 8_000 })
    .toBe(1);

  await page.locator('[data-mode="interact"]').click();
  await page.locator('[data-mode="comment"]').click();
  await page.locator('[data-mode="arrange"]').click();
  await page.waitForTimeout(400);

  expect(readyLabels.filter((l) => l === 'once')).toHaveLength(1);
});

test('Interact navigates on plandesk:// click without writing links', async ({ page }) => {
  const proto = await server.seedPrototype('Nav click', 390, 844);
  // Seed destination first so write-time resolution finds it.
  const pay = await server.seedPrototypeScreen(
    proto.id,
    'Pay',
    `<!doctype html><html><body><p id="pay">Pay screen</p>
      <script>parent.postMessage({ kind: 'plandesk:ready', label: 'pay' }, '*');</script>
    </body></html>`,
  );
  const home = await server.seedPrototypeScreen(
    proto.id,
    'Home',
    `<!doctype html><html><body>
      <a id="go" href="plandesk://artifact/Pay">Pay</a>
      <script>parent.postMessage({ kind: 'plandesk:ready', label: 'home' }, '*');</script>
    </body></html>`,
  );

  const before = await server.getPrototype(proto.id);
  expect(before.links.some((l) => l.to_artifact_id === pay.id)).toBe(true);
  const linkCountBefore = before.links.length;

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${home.id}"]`)).toBeVisible({
    timeout: 10_000,
  });

  await page.locator('[data-mode="interact"]').click();
  await page
    .frameLocator(`[data-screen-frame][data-artifact-id="${home.id}"]`)
    .locator('#go')
    .click();

  await expect
    .poll(
      async () => {
        return page
          .locator('.react-flow__node.selected [data-screen-node]')
          .getAttribute('data-artifact-id');
      },
      { timeout: 8_000 },
    )
    .toBe(pay.id);

  const after = await server.getPrototype(proto.id);
  expect(after.links).toHaveLength(linkCountBefore);
  expect(after.links.map((l) => l.id).sort()).toEqual(before.links.map((l) => l.id).sort());
});

test('broken link click toasts and does not navigate', async ({ page }) => {
  const proto = await server.seedPrototype('Broken nav', 390, 844);
  const start = await server.seedPrototypeScreen(
    proto.id,
    'Start',
    `<!doctype html><html><body>
      <a id="go" href="plandesk://artifact/DoesNotExist">go</a>
      <script>parent.postMessage({ kind: 'plandesk:ready', label: 'start' }, '*');</script>
    </body></html>`,
  );

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${start.id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('[data-mode="interact"]').click();

  await page
    .frameLocator(`[data-screen-frame][data-artifact-id="${start.id}"]`)
    .locator('#go')
    .click();

  await expect(page.getByText(/Unresolved link|DoesNotExist/i).first()).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
});

test('runtime CSP block and script error surface on the node', async ({ page }) => {
  const proto = await server.seedPrototype('Diagnostics', 390, 844);
  const blocked = await server.seedPrototypeScreen(
    proto.id,
    'Blocked',
    `<!doctype html><html><body>
      <p>probe</p>
      <script>
        parent.postMessage({ kind: 'plandesk:ready', label: 'blocked' }, '*');
        setTimeout(function () {
          var s = document.createElement('script');
          s.src = 'https://unpkg.com/x';
          document.body.appendChild(s);
        }, 0);
      </script>
    </body></html>`,
  );
  const broken = await server.seedPrototypeScreen(
    proto.id,
    'Throws',
    `<!doctype html><html><body>
      <p>boom</p>
      <script>
        parent.postMessage({ kind: 'plandesk:ready', label: 'throws' }, '*');
        setTimeout(function () { throw new Error('canvas-diag-boom'); }, 10);
      </script>
    </body></html>`,
  );
  // Keep Throws in view: place it next to Blocked.
  await server.patchArtifact(broken.id, { x: 500, y: 0 });

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${blocked.id}"]`)).toBeVisible({
    timeout: 10_000,
  });

  const blockedNode = page.locator(`[data-screen-node][data-artifact-id="${blocked.id}"]`);
  await expect
    .poll(async () => blockedNode.getAttribute('data-diagnostic-count'), { timeout: 10_000 })
    .not.toBe('0');

  await blockedNode.locator('[data-diagnostic-badge]').click();
  const blockedItem = blockedNode.locator('[data-diagnostic-kind="blocked"]').first();
  await expect(blockedItem).toBeVisible();
  await expect(blockedItem).toContainText(/script-src/i);
  await expect(blockedItem).toContainText(/unpkg\.com/);
  await expect(blockedItem).toContainText(/Runtime CSP/);

  const throwsNode = page.locator(`[data-screen-node][data-artifact-id="${broken.id}"]`);
  await expect
    .poll(async () => throwsNode.getAttribute('data-diagnostic-count'), { timeout: 10_000 })
    .not.toBe('0');
  await throwsNode.locator('[data-diagnostic-badge]').click();
  const errorItem = throwsNode.locator('[data-diagnostic-kind="error"]').first();
  await expect(errorItem).toBeVisible();
  await expect(errorItem).toContainText(/canvas-diag-boom/);
});

test('screen with no problems shows no diagnostic badge', async ({ page }) => {
  const proto = await server.seedPrototype('Clean diag', 390, 844);
  const screen = await server.seedPrototypeScreen(proto.id, 'Clean', READY_HTML('clean'));

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${screen.id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.waitForTimeout(500);
  await expect(
    page.locator(`[data-screen-node][data-artifact-id="${screen.id}"] [data-diagnostic-badge]`),
  ).toHaveCount(0);
  await expect(page.locator(`[data-screen-node][data-artifact-id="${screen.id}"]`)).toHaveAttribute(
    'data-diagnostic-count',
    '0',
  );
});
