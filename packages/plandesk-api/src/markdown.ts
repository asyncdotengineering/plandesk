import { Marked } from 'marked';

const HTML_BODY_RE = /^\s*<(?:[a-z][\w-]*)(?:\s|>|\/)/i;
const WIKI_LINK_RE = /\[\[([^\]]+?)(?:\|([^\]]+?))?\]\]/g;
const FENCED_PLACEHOLDER_RE = /@@PLANDESK_FENCED_(\d+)@@/g;
const INLINE_PLACEHOLDER_RE = /@@PLANDESK_INLINE_(\d+)@@/g;
const WIKI_PLACEHOLDER_RE = /@@PLANDESK_WIKI_(\d+)@@/g;

export type WikiLinkResolver = (title: string) => { id: string; title: string } | undefined;
export type WikiLinkResolved = { id: string; title: string };

export type ConvertDocumentBodyOptions = {
  resolve?: WikiLinkResolver;
  projectId?: string;
};

export type ConvertDocumentBodyResult = {
  html: string;
  resolved: WikiLinkResolved[];
};

// A private Marked instance, deliberately NOT the shared `marked` singleton.
// `plandesk serve` runs the CLI and the MCP server in one process sharing a
// single `marked` module; the CLI previewer registers an async marked-shiki
// extension on the global at import time, which would make a synchronous
// `marked.parse(..., { async: false })` throw. An owned instance has its own
// (synchronous) defaults and is immune to extensions registered elsewhere.
const md = new Marked({ gfm: true });

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function documentHref(projectId: string | undefined, documentId: string): string {
  if (projectId !== undefined) {
    return `/projects/${projectId}/documents/${documentId}`;
  }
  return `/documents/${documentId}`;
}

function protectFencedCode(body: string): { text: string; segments: string[] } {
  const segments: string[] = [];
  const text = body.replace(
    /(^|\n)((?:```|~~~)[\s\S]*?(?:```|~~~))/g,
    (_match, prefix: string, block: string) => {
      const index = segments.length;
      segments.push(block);
      return `${prefix}@@PLANDESK_FENCED_${String(index)}@@`;
    },
  );
  return { text, segments };
}

function protectInlineCode(body: string): { text: string; segments: string[] } {
  const segments: string[] = [];
  const text = body.replace(/`[^`\n]+`/g, (match) => {
    const index = segments.length;
    segments.push(match);
    return `@@PLANDESK_INLINE_${String(index)}@@`;
  });
  return { text, segments };
}

function restoreFencedPlaceholders(text: string, segments: string[]): string {
  return text.replace(
    FENCED_PLACEHOLDER_RE,
    (_match, index: string) => segments[Number(index)] ?? '',
  );
}

function restoreInlinePlaceholders(text: string, segments: string[]): string {
  return text.replace(
    INLINE_PLACEHOLDER_RE,
    (_match, index: string) => segments[Number(index)] ?? '',
  );
}

function replaceWikiLinksWithPlaceholders(
  body: string,
  options: ConvertDocumentBodyOptions,
  resolved: WikiLinkResolved[],
): { text: string; segments: string[] } {
  const segments: string[] = [];
  const seen = new Set<string>();
  const text = body.replace(WIKI_LINK_RE, (_match, rawTitle: string, rawDisplay?: string) => {
    const title = rawTitle.trim();
    const display = (rawDisplay ?? title).trim();
    const target = options.resolve?.(title);
    const html =
      target !== undefined
        ? (() => {
            if (!seen.has(target.id)) {
              seen.add(target.id);
              resolved.push(target);
            }
            return `<a href="${escapeHtml(documentHref(options.projectId, target.id))}">${escapeHtml(display)}</a>`;
          })()
        : `<span class="wikilink-unresolved" title="Unresolved link: ${escapeHtml(title)}">${escapeHtml(display)}</span>`;
    const index = segments.length;
    segments.push(html);
    return `@@PLANDESK_WIKI_${String(index)}@@`;
  });
  return { text, segments };
}

function restoreWikiLinkPlaceholders(text: string, segments: string[]): string {
  return text.replace(
    WIKI_PLACEHOLDER_RE,
    (_match, index: string) => segments[Number(index)] ?? '',
  );
}

export function convertDocumentBody(
  body: string,
  options: ConvertDocumentBodyOptions = {},
): ConvertDocumentBodyResult {
  if (body.trim() === '' || HTML_BODY_RE.test(body)) {
    return { html: body, resolved: [] };
  }

  const resolved: WikiLinkResolved[] = [];
  const fenced = protectFencedCode(body);
  const wiki = replaceWikiLinksWithPlaceholders(fenced.text, options, resolved);
  const inline = protectInlineCode(wiki.text);
  const restoredFenced = restoreFencedPlaceholders(inline.text, fenced.segments);
  const restoredInline = restoreInlinePlaceholders(restoredFenced, inline.segments);
  const parsed = md.parse(restoredInline) as string;
  return { html: restoreWikiLinkPlaceholders(parsed, wiki.segments), resolved };
}

// Document and note bodies are stored and rendered as HTML (the web editor is
// rich text). Agents naturally write Markdown, so convert it here; bodies that
// already look like HTML pass through untouched.
export function ensureHtmlBody(body: string, resolve?: WikiLinkResolver): string {
  return convertDocumentBody(body, { resolve }).html;
}
