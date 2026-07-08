import { Marked } from 'marked';

const HTML_BODY_RE = /^\s*<(?:[a-z][\w-]*)(?:\s|>|\/)/i;

// A private Marked instance, deliberately NOT the shared `marked` singleton.
// `plandesk serve` runs the CLI and the MCP server in one process sharing a
// single `marked` module; the CLI previewer registers an async marked-shiki
// extension on the global at import time, which would make a synchronous
// `marked.parse(..., { async: false })` throw. An owned instance has its own
// (synchronous) defaults and is immune to extensions registered elsewhere.
const md = new Marked({ gfm: true });

// Document and note bodies are stored and rendered as HTML (the web editor is
// rich text). Agents naturally write Markdown, so convert it here; bodies that
// already look like HTML pass through untouched.
export function ensureHtmlBody(body: string): string {
  if (body.trim() === '' || HTML_BODY_RE.test(body)) {
    return body;
  }
  return md.parse(body) as string;
}
