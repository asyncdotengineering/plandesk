import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { platform } from 'node:process';
import { marked } from 'marked';
import { hasPreviewExtension } from './args.js';

export type ArtifactKind = 'markdown' | 'html';

export type PreviewTarget = {
  index: number;
  path: string;
  name: string;
  kind: ArtifactKind;
};

/**
 * Strict, network-dead policy for a rendered HTML artifact. Mirrors the Claude
 * artifact model: no external requests (`connect-src 'none'`), inline styles
 * and scripts only, images limited to inline data. Applied both as a response
 * header and (by the caller) an in-document meta tag.
 */
export const HTML_ARTIFACT_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; " +
  "script-src 'unsafe-inline'; font-src data:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

/**
 * Markdown is rendered to static HTML and framed WITHOUT `allow-scripts`, so any
 * script the markdown injected can never execute — no sanitizer needed. This
 * policy hardens the framed document further.
 */
export const MARKDOWN_ARTIFACT_CSP =
  "default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; " +
  "font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

function kindForPath(path: string): ArtifactKind {
  const lower = path.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm') ? 'html' : 'markdown';
}

/** Resolve CLI path args to absolute, existing, previewable targets. */
export function resolvePreviewTargets(paths: string[]): PreviewTarget[] {
  const targets: PreviewTarget[] = [];
  for (const raw of paths) {
    if (!hasPreviewExtension(raw)) {
      continue;
    }
    const abs = resolve(raw);
    if (!existsSync(abs)) {
      continue;
    }
    targets.push({ index: targets.length, path: abs, name: basename(abs), kind: kindForPath(abs) });
  }
  return targets;
}

const READER_CSS = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.5rem; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { color: #e6e6e6; background: #0d0d0d; } }
  pre { background: rgba(127,127,127,.12); padding: .8rem 1rem; border-radius: 6px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  pre code { font-size: .85em; }
  table { border-collapse: collapse; } th, td { border: 1px solid rgba(127,127,127,.35); padding: .4rem .7rem; }
  img { max-width: 100%; } a { color: #2563eb; } blockquote { border-left: 3px solid rgba(127,127,127,.4);
    margin-left: 0; padding-left: 1rem; color: rgba(127,127,127,.95); }
`;

/** Render a markdown artifact to a self-contained, script-free HTML document. */
export function renderMarkdownArtifact(raw: string): string {
  const body = marked.parse(raw, { async: false, gfm: true });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${MARKDOWN_ARTIFACT_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${READER_CSS}</style></head><body>${body}</body></html>`;
}

/** Read an HTML artifact and inject a meta CSP that survives JS tampering. */
export function renderHtmlArtifact(raw: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${HTML_ARTIFACT_CSP}">`;
  if (/<head[\s>]/i.test(raw)) {
    return raw.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }
  return `${meta}\n${raw}`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
}

/**
 * The previewer chrome: a tab bar plus one sandboxed iframe per artifact.
 * Markdown frames omit `allow-scripts` (rendered content is static); HTML frames
 * allow scripts but the strict CSP keeps them network-dead.
 */
export function renderChrome(targets: PreviewTarget[]): string {
  const tabs = targets
    .map(
      (t, i) =>
        `<button class="tab${i === 0 ? ' active' : ''}" data-idx="${String(t.index)}">${escapeHtml(
          t.name,
        )}</button>`,
    )
    .join('');
  const frames = targets
    .map((t, i) => {
      const sandbox = t.kind === 'html' ? 'allow-scripts' : '';
      const idx = String(t.index);
      return `<iframe class="frame${i === 0 ? ' active' : ''}" data-idx="${idx}" sandbox="${sandbox}" src="/artifact/${idx}" title="${escapeHtml(t.name)}"></iframe>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>plandesk — ${escapeHtml(
    targets[0]?.name ?? 'preview',
  )}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; } html, body { margin: 0; height: 100%; }
  body { display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .tabs { display: flex; gap: .25rem; padding: .4rem .6rem; border-bottom: 1px solid rgba(127,127,127,.3);
    background: rgba(127,127,127,.06); overflow-x: auto; }
  .tab { border: 0; background: transparent; padding: .35rem .7rem; border-radius: 6px; cursor: pointer;
    font-size: .85rem; color: inherit; white-space: nowrap; }
  .tab.active { background: rgba(127,127,127,.2); font-weight: 600; }
  .frames { flex: 1; position: relative; } .frame { position: absolute; inset: 0; width: 100%; height: 100%;
    border: 0; display: none; background: canvas; } .frame.active { display: block; }
</style></head><body>
<div class="tabs">${tabs}</div><div class="frames">${frames}</div>
<script>
  const tabs = [...document.querySelectorAll('.tab')];
  const frames = [...document.querySelectorAll('.frame')];
  for (const tab of tabs) tab.addEventListener('click', () => {
    const idx = tab.dataset.idx;
    for (const el of [...tabs, ...frames]) el.classList.toggle('active', el.dataset.idx === idx);
  });
</script></body></html>`;
}

function openBrowser(url: string): void {
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: platform === 'win32' }).unref();
  } catch {
    // Non-fatal: the URL is printed regardless.
  }
}

export type RunPreviewOptions = {
  paths: string[];
  port?: number;
  host?: string;
  open?: boolean;
};

export const DEFAULT_PREVIEW_PORT = 4100;

/** Start the loopback previewer. Returns the exit code (0 on clean start). */
export function runPreview(options: RunPreviewOptions): number {
  const targets = resolvePreviewTargets(options.paths);
  if (targets.length === 0) {
    process.stderr.write(
      'plandesk preview: no previewable files (.md, .markdown, .html, .htm) found in the given paths\n',
    );
    return 1;
  }

  const host = options.host ?? '127.0.0.1';
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/' || url === '') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderChrome(targets));
      return;
    }
    const match = /^\/artifact\/(\d+)$/.exec(url);
    if (match) {
      const target = targets[Number(match[1])];
      if (!target) {
        res.writeHead(404).end('not found');
        return;
      }
      const raw = readFileSync(target.path, 'utf8');
      if (target.kind === 'html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': HTML_ARTIFACT_CSP,
        });
        res.end(renderHtmlArtifact(raw));
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': MARKDOWN_ARTIFACT_CSP,
        });
        res.end(renderMarkdownArtifact(raw));
      }
      return;
    }
    res.writeHead(404).end('not found');
  });

  const port = options.port ?? DEFAULT_PREVIEW_PORT;
  server.listen(port, host, () => {
    const url = `http://${host}:${String(port)}/`;
    process.stdout.write(
      `plandesk preview — ${String(targets.length)} file(s) at ${url}\n` +
        targets.map((t) => `  ${t.name} (${t.kind})`).join('\n') +
        '\n',
    );
    if (options.open !== false) {
      openBrowser(url);
    }
  });
  return 0;
}
