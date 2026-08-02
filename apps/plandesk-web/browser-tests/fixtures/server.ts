import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PLANDESK = join(REPO_ROOT, 'packages/plandesk-cli/bin/plandesk');

/** Matches HTML_ARTIFACT_CSP in packages/plandesk-cli/src/preview.tsx */
export const HTML_ARTIFACT_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; " +
  "script-src 'unsafe-inline'; font-src data:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

/** Distinctive payload the smoke test waits for from the framed HTML artifact. */
export const SMOKE_MESSAGE = {
  source: 'plandesk-browser-harness',
  kind: 'smoke',
  ok: true,
} as const;

export const SMOKE_HTML_CONTENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${HTML_ARTIFACT_CSP}" />
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

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`harness server did not become ready on ${baseUrl}`);
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

    return {
      baseUrl,
      projectId: project.id,
      htmlArtifactId: htmlArtifact.id,
      markdownArtifactId: markdownArtifact.id,
      htmlContent: htmlArtifact.content,
      markdownContent: markdownArtifact.content,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
