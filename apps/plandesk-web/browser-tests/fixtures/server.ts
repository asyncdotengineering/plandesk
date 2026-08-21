import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PLANDESK = join(REPO_ROOT, 'packages/plandesk-cli/bin/plandesk');

/** Distinctive payload the smoke test waits for from the framed HTML artifact. */
export const SMOKE_MESSAGE = {
  source: 'plandesk-browser-harness',
  kind: 'smoke',
  ok: true,
} as const;

/**
 * Seeded HTML content for the smoke screen. CSP + shim are prepended by
 * GET /artifacts/:id/render — do not embed them here.
 */
export const SMOKE_HTML_CONTENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
</head>
<body>
<p id="probe">harness-smoke</p>
<script>
parent.postMessage(${JSON.stringify(SMOKE_MESSAGE)}, '*');
</script>
</body>
</html>`;

export const SMOKE_MARKDOWN_CONTENT =
  '# Harness markdown\n\nSeeded for later REQ coverage against the frame contract.\n';

export type HarnessServer = {
  baseUrl: string;
  projectId: string;
  htmlArtifactId: string;
  markdownArtifactId: string;
  htmlContent: string;
  markdownContent: string;
  /** Create an additional HTML artifact and return its id. */
  seedHtmlArtifact: (title: string, content: string) => Promise<string>;
  /** Create a prototype in the harness project. */
  seedPrototype: (
    name: string,
    viewportWidth?: number,
    viewportHeight?: number,
  ) => Promise<{ id: string; viewport_width: number; viewport_height: number }>;
  /** Create an HTML screen on a prototype (no x/y — system lays out). */
  seedPrototypeScreen: (
    prototypeId: string,
    title: string,
    content: string,
  ) => Promise<{
    id: string;
    x: number | null;
    y: number | null;
    revision_id: string;
    prototype_id: string | null;
  }>;
  /** Mint a guest share link for a prototype; returns its token and portal url. */
  sharePrototype: (prototypeId: string) => Promise<{ token: string; url: string }>;
  patchArtifact: (
    id: string,
    body: Record<string, unknown>,
  ) => Promise<{
    id: string;
    x: number | null;
    y: number | null;
    revision_id: string;
    content: string;
  }>;
  getPrototype: (id: string) => Promise<{
    id: string;
    viewport_width: number;
    viewport_height: number;
    screens: Array<{
      id: string;
      title: string;
      x: number | null;
      y: number | null;
      revision_id: string;
    }>;
    links: Array<{
      id: string;
      from_artifact_id: string;
      to_artifact_id: string | null;
      raw_target: string;
    }>;
  }>;
  listArtifactComments: (artifactId: string) => Promise<
    Array<{
      id: string;
      body: string;
      passage: string | null;
      anchor: string | null;
    }>
  >;
  stop: () => Promise<void>;
};

function ephemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('ephemeralPort: failed to bind loopback'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

// A cold `plandesk serve` boot against a fresh data dir is not fast, and these
// specs run several suites plus a dev server on the same box. The old 5s budget
// turned a slow boot into a suite-wide abort; a genuinely dead server still
// fails with the same message, just later, so the longer budget hides nothing.
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 200;

async function waitForHealth(baseUrl: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) {
        const body = (await response.json()) as { ok?: boolean };
        if (body.ok === true) {
          return;
        }
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  throw new Error(
    `harness server did not become ready on ${baseUrl} after ${String(Date.now() - startedAt)}ms`,
  );
}

function runPlandesk(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(PLANDESK, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`plandesk ${args.join(' ')} exited ${String(code)}`));
    });
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${url} → ${String(response.status)}`);
  }
  return (await response.json()) as T;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${url} → ${String(response.status)}`);
  }
  return (await response.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} → ${String(response.status)}`);
  }
  return (await response.json()) as T;
}

/**
 * Boots the built CLI serve binary on an ephemeral loopback port (same shape as
 * scripts/validate.sh), seeds one project with one html and one markdown
 * artifact, and tears down the process + data dir even when callers throw.
 */
export async function startHarnessServer(): Promise<HarnessServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-browser-harness.'));
  const port = await ephemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  let child: ChildProcess | undefined;
  let stopping = false;

  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    if (child?.pid !== undefined) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // already exited
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        child?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    await runPlandesk(['init', '--data-dir', dataDir]);
    child = spawn(PLANDESK, ['serve', '--port', String(port), '--data-dir', dataDir], {
      stdio: 'ignore',
    });
    child.on('error', (error) => {
      console.error('harness serve spawn error', error);
    });

    await waitForHealth(baseUrl);

    const project = await postJson<{ id: string }>(`${baseUrl}/api/v1/projects`, {
      name: 'browser-harness',
    });

    const htmlArtifact = await postJson<{ id: string; content: string }>(
      `${baseUrl}/api/v1/projects/${project.id}/artifacts`,
      {
        title: 'Harness HTML smoke',
        kind: 'html',
        content: SMOKE_HTML_CONTENT,
      },
    );

    const markdownArtifact = await postJson<{ id: string; content: string }>(
      `${baseUrl}/api/v1/projects/${project.id}/artifacts`,
      {
        title: 'Harness markdown seed',
        kind: 'markdown',
        content: SMOKE_MARKDOWN_CONTENT,
      },
    );

    const seedHtmlArtifact = async (title: string, content: string): Promise<string> => {
      const created = await postJson<{ id: string }>(
        `${baseUrl}/api/v1/projects/${project.id}/artifacts`,
        { title, kind: 'html', content },
      );
      return created.id;
    };

    const seedPrototype = async (name: string, viewportWidth = 390, viewportHeight = 844) => {
      return postJson<{ id: string; viewport_width: number; viewport_height: number }>(
        `${baseUrl}/api/v1/projects/${project.id}/prototypes`,
        {
          name,
          viewport_width: viewportWidth,
          viewport_height: viewportHeight,
        },
      );
    };

    const seedPrototypeScreen = async (prototypeId: string, title: string, content: string) => {
      return postJson<{
        id: string;
        x: number | null;
        y: number | null;
        revision_id: string;
        prototype_id: string | null;
      }>(`${baseUrl}/api/v1/projects/${project.id}/artifacts`, {
        title,
        kind: 'html',
        content,
        prototype_id: prototypeId,
      });
    };

    /** Mint a guest share link for a prototype and return its token. */
    const sharePrototype = async (prototypeId: string) => {
      const share = await postJson<{ url: string }>(
        `${baseUrl}/api/v1/prototypes/${prototypeId}/share`,
        { expires: '24h' },
      );
      const token = share.url.split('/p/')[1];
      if (token === undefined || token.length === 0) {
        throw new Error(`share url carried no token: ${share.url}`);
      }
      return { token, url: `${baseUrl}/p/${token}` };
    };

    const patchArtifact = async (id: string, body: Record<string, unknown>) => {
      return patchJson<{
        id: string;
        x: number | null;
        y: number | null;
        revision_id: string;
        content: string;
      }>(`${baseUrl}/api/v1/artifacts/${id}`, body);
    };

    const getPrototype = async (id: string) => {
      return getJson<{
        id: string;
        viewport_width: number;
        viewport_height: number;
        screens: Array<{
          id: string;
          title: string;
          x: number | null;
          y: number | null;
          revision_id: string;
        }>;
        links: Array<{
          id: string;
          from_artifact_id: string;
          to_artifact_id: string | null;
          raw_target: string;
        }>;
      }>(`${baseUrl}/api/v1/prototypes/${id}`);
    };

    const listArtifactComments = async (artifactId: string) => {
      return getJson<
        Array<{
          id: string;
          body: string;
          passage: string | null;
          anchor: string | null;
        }>
      >(
        `${baseUrl}/api/v1/projects/${project.id}/artifact-comments?artifact_id=${encodeURIComponent(artifactId)}&include_resolved=true`,
      );
    };

    return {
      baseUrl,
      projectId: project.id,
      htmlArtifactId: htmlArtifact.id,
      markdownArtifactId: markdownArtifact.id,
      htmlContent: htmlArtifact.content,
      markdownContent: markdownArtifact.content,
      seedHtmlArtifact,
      seedPrototype,
      seedPrototypeScreen,
      sharePrototype,
      patchArtifact,
      getPrototype,
      listArtifactComments,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
