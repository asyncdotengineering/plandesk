import { marked } from 'marked';

const HTML_BODY_RE = /^\s*<(?:[a-z][\w-]*)(?:\s|>|\/)/i;

// Bodies are stored as HTML, but documents written by agents before the MCP
// server converted Markdown (and any future plain-Markdown writes) should
// still render as rich text instead of a collapsed blob.
export function bodyToHtml(body: string): string {
  if (body.trim() === '' || HTML_BODY_RE.test(body)) {
    return body;
  }
  return marked.parse(body, { async: false, gfm: true });
}
