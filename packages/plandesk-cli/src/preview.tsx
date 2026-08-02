import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { cwd, platform } from 'node:process';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { html, raw as unsafeRaw } from 'hono/html';
import { marked } from 'marked';
import markedShiki from 'marked-shiki';
import { codeToHtml } from 'shiki';
import { htmlArtifactCsp } from '@plandesk/api';
import {
  addAnnotation,
  listAnnotations,
  resolveAnnotation,
  type ArtifactAnnotation,
} from './annotations-store.js';
import { findLocalPlandeskDir, hasPreviewExtension } from './args.js';
import {
  getBoundProjectId,
  normalizeServerUrl,
  resolvePlandeskBinding,
} from './connect-artifacts.js';

export { htmlArtifactCsp };

const require = createRequire(import.meta.url);
let mermaidBundle: string | undefined;

function getMermaidBundle(): string {
  if (!mermaidBundle) {
    mermaidBundle = readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
  }
  return mermaidBundle;
}

marked.use(
  markedShiki({
    highlight: async (code, lang) => {
      if (lang === 'mermaid') {
        const esc = code.replace(
          /[&<>]/g,
          (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character as '&' | '<' | '>'],
        );
        return `<pre class="mermaid">${esc}</pre>`;
      }
      try {
        const highlighted = await codeToHtml(code, {
          lang: lang || 'text',
          themes: { light: 'github-light', dark: 'github-dark' },
        });
        return highlighted.replace(/^<pre class="shiki[^"]*"/, '<pre class="shiki"');
      } catch {
        return `<pre><code>${code.replace(
          /[&<>]/g,
          (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character as '&' | '<' | '>'],
        )}</code></pre>`;
      }
    },
  }),
);

export type ArtifactKind = 'markdown' | 'html';

export type PreviewTarget = {
  index: number;
  path: string;
  name: string;
  kind: ArtifactKind;
  mode: 'file' | 'folder';
  root: string;
  rel: string;
};

export type TextSelector = {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
};

/** Build a text-quote selector with short surrounding context. */
export function computeSelector(bodyText: string, exact: string, start: number): TextSelector {
  const end = start + exact.length;
  return {
    exact,
    prefix: bodyText.slice(Math.max(0, start - 32), start),
    suffix: bodyText.slice(end, end + 32),
    start,
    end,
  };
}

/**
 * Thin constant wrapper around `htmlArtifactCsp` for the local CLI previewer
 * (loopback, no request URL at module load). Call sites that have a request
 * should prefer `htmlArtifactCsp(new URL(c.req.url).origin)` instead.
 *
 * Names an explicit origin rather than `'self'` so the policy survives a proxy
 * or CDN in front of the API; a browser spike showed `'self'` *does* match in
 * opaque-origin framed docs when the policy arrived as a header — the old
 * "matches nothing" rationale is stale.
 */
export const HTML_ARTIFACT_CSP = htmlArtifactCsp('http://127.0.0.1');

/**
 * Markdown is rendered to static HTML and framed WITHOUT `allow-scripts`, so any
 * script the markdown injected can never execute — no sanitizer needed. This
 * policy hardens the framed document further.
 */
export const MARKDOWN_ARTIFACT_CSP =
  "default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; " +
  "font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * Same-origin static policy for folder-mode tree responses. Allows sibling
 * assets under `/tree/:idx/` while blocking scripts and external network.
 */
export const FOLDER_CSP =
  "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data:; script-src 'none'; connect-src 'none'; base-uri 'self'; " +
  "form-action 'none'";

/** Resolve subpath inside root; returns null on traversal escape. */
export function resolveWithinRoot(root: string, subpath: string): string | null {
  const resolved = resolve(root, subpath);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

function kindForPath(path: string): ArtifactKind {
  const lower = path.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm') ? 'html' : 'markdown';
}

const MAX_FOLDER_DEPTH = 6;
const MAX_FOLDER_FILES = 200;

function walkPreviewableFiles(dir: string, depth: number, acc: string[]): void {
  if (depth > MAX_FOLDER_DEPTH || acc.length >= MAX_FOLDER_FILES) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (acc.length >= MAX_FOLDER_FILES) {
      return;
    }
    const name = entry.name;
    if (name.startsWith('.') || name === 'node_modules') {
      continue;
    }
    const full = join(dir, name);
    if (entry.isDirectory()) {
      walkPreviewableFiles(full, depth + 1, acc);
    } else if (entry.isFile() && hasPreviewExtension(full)) {
      acc.push(full);
    }
  }
}

/** Resolve CLI path args to absolute, existing, previewable targets. */
export function resolvePreviewTargets(paths: string[]): PreviewTarget[] {
  const byPath = new Map<string, PreviewTarget>();
  for (const raw of paths) {
    const abs = resolve(raw);
    if (!existsSync(abs)) {
      continue;
    }
    if (statSync(abs).isDirectory()) {
      const root = abs;
      const files: string[] = [];
      walkPreviewableFiles(root, 0, files);
      for (const filePath of files) {
        if (byPath.has(filePath)) {
          continue;
        }
        const rel = relative(root, filePath);
        byPath.set(filePath, {
          index: 0,
          path: filePath,
          name: rel,
          kind: kindForPath(filePath),
          mode: 'folder',
          root,
          rel,
        });
      }
      continue;
    }
    if (!hasPreviewExtension(raw)) {
      continue;
    }
    if (byPath.has(abs)) {
      continue;
    }
    byPath.set(abs, {
      index: 0,
      path: abs,
      name: basename(abs),
      kind: kindForPath(abs),
      mode: 'file',
      root: '',
      rel: '',
    });
  }
  const targets = [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
  return targets.map((target, index) => ({ ...target, index }));
}

const READER_CSS = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.5rem; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { color: #e6e6e6; background: #0d0d0d; } }
  pre { background: rgba(127,127,127,.12); padding: .8rem 1rem; border-radius: 6px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  pre code { font-size: .85em; }
  @media (prefers-color-scheme: dark) {
    .shiki, .shiki span { color: var(--shiki-dark, inherit) !important;
      background-color: var(--shiki-dark-bg, transparent) !important; }
  }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid rgba(127,127,127,.35); padding: .4rem .7rem; text-align: left; }
  th { background: rgba(127,127,127,.12); }
  .mermaid-rendered { margin: 1rem 0; text-align: center; }
  .mermaid-rendered svg { max-width: 100%; height: auto; }
  img { max-width: 100%; } a { color: #2563eb; } blockquote { border-left: 3px solid rgba(127,127,127,.4);
    margin-left: 0; padding-left: 1rem; color: rgba(127,127,127,.95); }
`;

/** Render a markdown artifact to a self-contained, script-free HTML document. */
export async function renderMarkdownArtifact(
  rawMarkdown: string,
  csp: string = MARKDOWN_ARTIFACT_CSP,
): Promise<string> {
  const body = await marked.parse(rawMarkdown, { async: true, gfm: true });
  const cspMeta = html`<meta http-equiv="Content-Security-Policy" content="${unsafeRaw(csp)}" />`;
  const document = (
    <html>
      <head>
        <meta charset="utf-8" />
        {cspMeta}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style dangerouslySetInnerHTML={{ __html: READER_CSS }} />
      </head>
      <body dangerouslySetInnerHTML={{ __html: body }} />
    </html>
  );
  // Hono renderables define their own HTML serialization; this is not Object#toString.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return html`<!doctype html>${document}`.toString();
}

function sandboxForTarget(target: PreviewTarget): string {
  if (target.mode === 'folder') {
    return 'allow-same-origin';
  }
  return target.kind === 'html' ? 'allow-scripts' : 'allow-same-origin';
}

function iframeSrcForTarget(target: PreviewTarget): string {
  if (target.mode === 'folder') {
    return `/tree/${String(target.index)}/${target.rel}`;
  }
  return `/artifact/${String(target.index)}`;
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.css')) {
    return 'text/css';
  }
  if (lower.endsWith('.js')) {
    return 'text/javascript';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lower.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.json')) {
    return 'application/json';
  }
  if (lower.endsWith('.woff2')) {
    return 'font/woff2';
  }
  if (lower.endsWith('.ico')) {
    return 'image/x-icon';
  }
  return 'application/octet-stream';
}

/** Read an HTML artifact and inject a meta CSP that survives JS tampering. */
export function renderHtmlArtifact(raw: string, csp: string = HTML_ARTIFACT_CSP): string {
  // Hono's raw() returns a branded string object whose serializer preserves the CSP verbatim.
  //
  // Keep the template on ONE line. It is a template literal, so a multi-line
  // reformat puts newlines and indentation *inside the emitted tag* — which
  // broke `renderHtmlArtifact('<h1>bare</h1>').startsWith('<meta http-equiv=')`.
  // prettier-ignore
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const meta = html`<meta http-equiv="Content-Security-Policy" content="${unsafeRaw(csp)}" />`.toString();
  if (/<head[\s>]/i.test(raw)) {
    return raw.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }
  return `${meta}\n${raw}`;
}

/**
 * The previewer chrome: a tab bar plus one sandboxed iframe per artifact.
 * Markdown frames omit `allow-scripts` (rendered content is static); HTML frames
 * allow scripts but the strict CSP keeps them network-dead.
 */
export function renderChrome(targets: PreviewTarget[]): string {
  const chromeCss = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; } html, body { margin: 0; height: 100%; }
  body { display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .tabs { display: flex; gap: .25rem; padding: .4rem .6rem; border-bottom: 1px solid rgba(127,127,127,.3);
    background: rgba(127,127,127,.06); overflow-x: auto; }
  .tab { border: 0; background: transparent; padding: .35rem .7rem; border-radius: 6px; cursor: pointer;
    font-size: .85rem; color: inherit; white-space: nowrap; }
  .tab.active { background: rgba(127,127,127,.2); font-weight: 600; }
  .workspace { display: flex; flex: 1; min-height: 0; }
  .frames { flex: 1; position: relative; min-width: 0; } .frame { position: absolute; inset: 0; width: 100%; height: 100%;
    border: 0; display: none; background: canvas; } .frame.active { display: block; }
  #rail { width: 300px; overflow-y: auto; padding: 1rem; border-left: 1px solid rgba(127,127,127,.3);
    background: rgba(127,127,127,.04); }
  #rail h2 { margin: 0 0 .8rem; font-size: 1rem; } .rail-hint { opacity: .65; font-size: .8rem; }
  .annotation { padding: .75rem 0; border-top: 1px solid rgba(127,127,127,.25); cursor: pointer; }
  .annotation.resolved { opacity: .45; } .passage { margin: 0 0 .35rem; font-size: .78rem; font-style: italic; }
  .annotation-body { margin: 0 0 .5rem; white-space: pre-wrap; } button { color: inherit; }
  .annotation button, .composer button, #add-note { border: 1px solid rgba(127,127,127,.4); border-radius: 5px;
    background: canvas; padding: .3rem .55rem; cursor: pointer; }
  .composer { margin-bottom: 1rem; } .composer textarea { display: block; width: 100%; min-height: 6rem;
    margin: .5rem 0; padding: .5rem; resize: vertical; color: inherit; background: canvas; }
  .composer-actions { display: flex; gap: .4rem; }
  #add-note { position: fixed; z-index: 10; display: none; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
`;
  const clientScript = String.raw`
  const tabs = [...document.querySelectorAll('.tab')];
  const frames = [...document.querySelectorAll('.frame')];
  const rail = document.querySelector('#rail');
  const addNote = document.querySelector('#add-note');
  let active = Number(frames[0].dataset.idx);
  let pendingSelection = null;

  function element(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function activeFrame() {
    return frames.find((frame) => Number(frame.dataset.idx) === active);
  }

  function hideAddNote() {
    addNote.style.display = 'none';
  }

  function composer(title, selection) {
    const form = element('form', 'composer');
    form.append(element('strong', '', title));
    const textarea = element('textarea');
    textarea.required = true;
    textarea.placeholder = 'Write a note';
    form.append(textarea);
    const actions = element('div', 'composer-actions');
    const save = element('button', '', 'Save');
    save.type = 'submit';
    const cancel = element('button', '', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      textarea.value = '';
      if (selection) form.remove();
    });
    actions.append(save, cancel);
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = textarea.value.trim();
      if (!body) return;
      const payload = selection
        ? { idx: active, passage: selection.exact, anchor: JSON.stringify(selection), body }
        : { idx: active, passage: null, anchor: null, body };
      const response = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return;
      const frame = activeFrame();
      frame.contentWindow?.getSelection()?.removeAllRanges();
      pendingSelection = null;
      hideAddNote();
      await loadAnnotations();
    });
    return form;
  }

  function focusPassage(passage) {
    const frame = activeFrame();
    if (!passage || frame.dataset.kind !== 'markdown') return;
    const doc = frame.contentDocument;
    const body = doc?.body;
    if (!doc || !body) return;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length });
      text += node.nodeValue ?? '';
    }
    const start = text.indexOf(passage);
    if (start < 0) return;
    const end = start + passage.length;
    const first = nodes.find((entry) => entry.start + (entry.node.nodeValue ?? '').length > start);
    const last = [...nodes].reverse().find((entry) => entry.start < end);
    if (!first || !last) return;
    const range = doc.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    const target = first.node.parentElement;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (target) {
      target.style.outline = '2px solid #f59e0b';
      setTimeout(() => { target.style.outline = ''; }, 1200);
    }
  }

  function renderRail(annotations) {
    rail.replaceChildren();
    rail.append(element('h2', '', 'Annotations (' + String(annotations.length) + ')'));
    const frame = activeFrame();
    if (frame.dataset.kind === 'html') {
      rail.append(composer('Comment on this artifact', null));
    } else {
      rail.append(element('p', 'rail-hint', 'Select text in the preview to add a note.'));
    }
    const ordered = [...annotations].sort((a, b) =>
      Number(a.resolved) - Number(b.resolved) || b.createdAt.localeCompare(a.createdAt));
    for (const annotation of ordered) {
      const item = element('article', 'annotation' + (annotation.resolved ? ' resolved' : ''));
      item.append(element('p', 'passage', annotation.passage ? '“' + annotation.passage + '”' : 'whole file'));
      item.append(element('p', 'annotation-body', annotation.body));
      if (!annotation.resolved) {
        const resolveButton = element('button', '', 'Resolve');
        resolveButton.type = 'button';
        resolveButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          const response = await fetch('/api/annotations/' + encodeURIComponent(annotation.id) + '/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idx: active }),
          });
          if (response.ok) await loadAnnotations();
        });
        item.append(resolveButton);
      }
      item.addEventListener('click', () => focusPassage(annotation.passage));
      rail.append(item);
    }
  }

  async function loadAnnotations() {
    const requested = active;
    const response = await fetch('/api/annotations?idx=' + String(requested));
    if (!response.ok || requested !== active) return;
    renderRail(await response.json());
  }

  function handleSelection(frame) {
    if (frame !== activeFrame()) return;
    const selection = frame.contentWindow?.getSelection();
    const exact = selection?.toString() ?? '';
    if (!selection || selection.rangeCount === 0 || !exact.trim()) {
      hideAddNote();
      return;
    }
    const body = frame.contentDocument?.body;
    if (!body) return;
    const bodyText = body.innerText;
    const range = selection.getRangeAt(0);
    const before = range.cloneRange();
    before.selectNodeContents(body);
    before.setEnd(range.startContainer, range.startOffset);
    const approximateStart = before.toString().length;
    const nearbyStart = bodyText.indexOf(exact, Math.max(0, approximateStart - 32));
    const start = nearbyStart >= 0 ? nearbyStart : bodyText.indexOf(exact);
    if (start < 0) {
      hideAddNote();
      return;
    }
    pendingSelection = {
      exact,
      prefix: bodyText.slice(Math.max(0, start - 32), start),
      suffix: bodyText.slice(start + exact.length, start + exact.length + 32),
      start,
      end: start + exact.length,
    };
    const rect = range.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    addNote.style.left = String(Math.min(window.innerWidth - 90, frameRect.left + rect.right + 6)) + 'px';
    addNote.style.top = String(Math.max(4, frameRect.top + rect.top - 34)) + 'px';
    addNote.style.display = 'block';
  }

  let mermaidLoadPromise = null;
  function ensureMermaid() {
    if (window.mermaid) return Promise.resolve();
    if (mermaidLoadPromise) return mermaidLoadPromise;
    mermaidLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/mermaid.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('mermaid load failed'));
      document.head.appendChild(script);
    });
    return mermaidLoadPromise;
  }

  async function renderMermaidInFrame(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    const blocks = doc.querySelectorAll('pre.mermaid');
    if (!blocks.length) return;
    await ensureMermaid();
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
    let i = 0;
    for (const el of blocks) {
      try {
        const { svg } = await window.mermaid.render('mmd-' + (i++), el.textContent);
        const wrap = doc.createElement('div');
        wrap.className = 'mermaid-rendered';
        wrap.innerHTML = svg;
        el.replaceWith(wrap);
      } catch {
        /* leave the source block on failure */
      }
    }
  }

  const wiredFrames = new WeakSet();
  async function wireMarkdownFrame(frame) {
    const doc = frame.contentDocument;
    if (!doc || wiredFrames.has(doc)) return;
    wiredFrames.add(doc);
    doc.addEventListener('mouseup', () => handleSelection(frame));
    await renderMermaidInFrame(frame);
  }
  for (const frame of frames) {
    if (frame.dataset.kind === 'markdown') {
      frame.addEventListener('load', () => { void wireMarkdownFrame(frame); });
      void wireMarkdownFrame(frame);
    }
  }
  addNote.addEventListener('click', () => {
    if (!pendingSelection) return;
    rail.querySelector('.composer')?.remove();
    rail.insertBefore(composer('Add note', pendingSelection), rail.children[1] ?? null);
    rail.querySelector('textarea')?.focus();
    hideAddNote();
  });
  for (const tab of tabs) tab.addEventListener('click', () => {
    const idx = tab.dataset.idx;
    for (const el of [...tabs, ...frames]) el.classList.toggle('active', el.dataset.idx === idx);
    active = Number(idx);
    pendingSelection = null;
    hideAddNote();
    void loadAnnotations();
  });
  void loadAnnotations();
`;
  const document = (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>plandesk — {targets[0]?.name ?? 'preview'}</title>
        <style dangerouslySetInnerHTML={{ __html: chromeCss }} />
      </head>
      <body>
        <div class="tabs">
          {targets.map((target, index) => (
            <button class={`tab${index === 0 ? ' active' : ''}`} data-idx={String(target.index)}>
              {target.name}
            </button>
          ))}
        </div>
        <div class="workspace">
          <div class="frames">
            {targets.map((target, index) => (
              <iframe
                class={`frame${index === 0 ? ' active' : ''}`}
                data-idx={String(target.index)}
                data-kind={target.kind}
                sandbox={sandboxForTarget(target)}
                src={iframeSrcForTarget(target)}
                title={target.name}
              />
            ))}
          </div>
          <aside id="rail" />
        </div>
        <button id="add-note" type="button">
          Add note
        </button>
        <script dangerouslySetInnerHTML={{ __html: clientScript }} />
      </body>
    </html>
  );
  // Hono renderables define their own HTML serialization; this is not Object#toString.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return html`<!doctype html>${document}`.toString();
}

function annotationTarget(targets: PreviewTarget[], value: unknown): PreviewTarget | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? targets[value] : undefined;
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function openBrowser(url: string): void {
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: platform === 'win32' }).unref();
  } catch {
    // Non-fatal: the URL is printed regardless.
  }
}

/** The annotation shape the previewer client renders (sidecar-native). */
export type ClientAnnotation = ArtifactAnnotation;

/**
 * Where annotations live. In a connected repo they go to the plandesk API (DB),
 * so the agent sees them over MCP; standalone they go to the local sidecar.
 * One backend per context — never both, so a file's annotations never fragment.
 */
export type AnnotationBackend = {
  list(target: PreviewTarget): Promise<ClientAnnotation[]>;
  create(
    target: PreviewTarget,
    input: { passage: string | null; anchor: string | null; body: string },
  ): Promise<ClientAnnotation>;
  resolve(target: PreviewTarget, id: string): Promise<boolean>;
};

export type PreviewWorkspace = { serverUrl: string; projectId: string; token?: string };

/** Resolve the connected-repo context by walking up from cwd. Token is optional (loopback). */
export function resolvePreviewWorkspace(startDir: string = cwd()): PreviewWorkspace | undefined {
  const plandeskDir = findLocalPlandeskDir(startDir);
  if (plandeskDir === undefined) {
    return undefined;
  }
  const binding = resolvePlandeskBinding(dirname(plandeskDir));
  if (binding === undefined) {
    return undefined;
  }
  const projectId = getBoundProjectId(binding.config);
  if (projectId === undefined) {
    return undefined;
  }
  const workspace: PreviewWorkspace = {
    serverUrl: normalizeServerUrl(binding.config.serverUrl),
    projectId,
  };
  if (binding.token !== undefined) {
    workspace.token = binding.token;
  }
  return workspace;
}

export function previewBackendBanner(workspace: PreviewWorkspace | undefined): string {
  return workspace
    ? `annotations → ${workspace.serverUrl} (project ${workspace.projectId})`
    : 'annotations → local sidecar';
}

export function annotationRequestHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined && token !== '') {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

const sidecarBackend: AnnotationBackend = {
  list: (target) => Promise.resolve(listAnnotations(target.path)),
  create: (target, input) =>
    Promise.resolve(addAnnotation(target.path, readFileSync(target.path, 'utf8'), input)),
  resolve: (target, id) => Promise.resolve(resolveAnnotation(target.path, id)),
};

/** Map an API SerializedComment onto the client annotation shape. */
function toClientAnnotation(c: {
  id: string;
  passage: string | null;
  anchor: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
}): ClientAnnotation {
  return {
    id: c.id,
    passage: c.passage,
    anchor: c.anchor,
    body: c.body,
    resolved: c.resolved,
    createdAt: c.created_at,
  };
}

function apiBackend(workspace: PreviewWorkspace): AnnotationBackend {
  const base = `${workspace.serverUrl}/api/v1`;
  const headers = annotationRequestHeaders(workspace.token);
  const artifactId = (target: PreviewTarget): string => `file://${target.path}`;
  return {
    async list(target) {
      const url = `${base}/projects/${workspace.projectId}/artifact-comments?artifact_id=${encodeURIComponent(artifactId(target))}&include_resolved=true`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`artifact-comments list failed: ${String(res.status)}`);
      }
      return ((await res.json()) as Parameters<typeof toClientAnnotation>[0][]).map(
        toClientAnnotation,
      );
    },
    async create(target, input) {
      const res = await fetch(`${base}/projects/${workspace.projectId}/artifact-comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ artifact_id: artifactId(target), ...input }),
      });
      if (!res.ok) {
        throw new Error(`artifact-comments create failed: ${String(res.status)}`);
      }
      return toClientAnnotation((await res.json()) as Parameters<typeof toClientAnnotation>[0]);
    },
    async resolve(_target, id) {
      const res = await fetch(`${base}/comments/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ resolved: true }),
      });
      return res.ok;
    },
  };
}

export type RunPreviewOptions = {
  paths: string[];
  port?: number;
  host?: string;
  open?: boolean;
  /** Override the annotation backend (default: API when connected, else sidecar). */
  backend?: AnnotationBackend;
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
  const workspace = options.backend ? undefined : resolvePreviewWorkspace();
  const backend = options.backend ?? (workspace ? apiBackend(workspace) : sidecarBackend);
  const app = new Hono();

  app.get('/', (c) => c.html(renderChrome(targets)));

  app.get('/vendor/mermaid.min.js', (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    return c.body(getMermaidBundle());
  });

  app.get('/artifact/:idx', async (c) => {
    const target = annotationTarget(targets, Number(c.req.param('idx')));
    if (!target || target.mode !== 'file') {
      return c.text('not found', 404);
    }
    const artifact = readFileSync(target.path, 'utf8');
    if (target.kind === 'html') {
      const csp = htmlArtifactCsp(new URL(c.req.url).origin);
      c.header('Content-Security-Policy', csp);
      return c.html(renderHtmlArtifact(artifact, csp));
    }
    c.header('Content-Security-Policy', MARKDOWN_ARTIFACT_CSP);
    return c.html(await renderMarkdownArtifact(artifact));
  });

  app.get('/tree/:idx/:sub{.*}', async (c) => {
    const target = annotationTarget(targets, Number(c.req.param('idx')));
    if (!target || target.mode !== 'folder') {
      return c.text('not found', 404);
    }
    const subpath = c.req.param('sub');
    const resolved = resolveWithinRoot(target.root, subpath);
    if (resolved === null || !existsSync(resolved) || !statSync(resolved).isFile()) {
      return c.text('not found', 404);
    }
    c.header('Content-Security-Policy', FOLDER_CSP);
    const lower = resolved.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
      const artifact = readFileSync(resolved, 'utf8');
      return c.html(await renderMarkdownArtifact(artifact, FOLDER_CSP));
    }
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      return c.body(readFileSync(resolved, 'utf8'), 200, {
        'Content-Type': 'text/html; charset=utf-8',
      });
    }
    const contentType = contentTypeForPath(resolved);
    return c.body(readFileSync(resolved), 200, { 'Content-Type': contentType });
  });

  app.get('/api/annotations', async (c) => {
    const rawIdx = c.req.query('idx');
    const target = rawIdx === undefined ? undefined : annotationTarget(targets, Number(rawIdx));
    if (!target) {
      return c.text('invalid artifact index', 400);
    }
    try {
      return c.json(await backend.list(target));
    } catch {
      return c.text('annotation backend unavailable', 502);
    }
  });

  app.post('/api/annotations', async (c) => {
    let input: Record<string, unknown> | undefined;
    try {
      input = jsonRecord(await c.req.json());
    } catch {
      return c.text('invalid JSON', 400);
    }
    const target = annotationTarget(targets, input?.idx);
    if (!target || typeof input?.body !== 'string' || input.body.trim().length === 0) {
      return c.text('invalid annotation', 400);
    }
    try {
      const annotation = await backend.create(target, {
        passage: typeof input.passage === 'string' ? input.passage : null,
        anchor: typeof input.anchor === 'string' ? input.anchor : null,
        body: input.body,
      });
      return c.json(annotation, 201);
    } catch {
      return c.text('annotation backend unavailable', 502);
    }
  });

  app.post('/api/annotations/:id/resolve', async (c) => {
    try {
      const input = jsonRecord(await c.req.json());
      const target = annotationTarget(targets, input?.idx);
      if (!target) {
        return c.text('invalid artifact index', 400);
      }
      if (!(await backend.resolve(target, c.req.param('id')))) {
        return c.text('not found', 404);
      }
      return c.json({ ok: true });
    } catch {
      return c.text('invalid JSON', 400);
    }
  });

  app.notFound((c) => c.text('not found', 404));

  const port = options.port ?? DEFAULT_PREVIEW_PORT;
  serve({ fetch: app.fetch, port, hostname: host }, () => {
    const url = `http://${host}:${String(port)}/`;
    process.stdout.write(
      `plandesk preview — ${String(targets.length)} file(s) at ${url}\n` +
        `  ${previewBackendBanner(workspace)}\n` +
        targets.map((t) => `  ${t.name} (${t.kind})`).join('\n') +
        '\n',
    );
    if (options.open !== false) {
      openBrowser(url);
    }
  });
  return 0;
}
