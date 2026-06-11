import { marked } from 'marked';

const HTML_BODY_RE = /^\s*<(?:[a-z][\w-]*)(?:\s|>|\/)/i;

// Document bodies are stored and rendered as HTML (the web editor is rich
// text). Agents naturally write Markdown, so convert it here; bodies that
// already look like HTML pass through untouched.
export function ensureHtmlBody(body: string): string {
  if (body.trim() === '' || HTML_BODY_RE.test(body)) {
    return body;
  }
  return marked.parse(body, { async: false, gfm: true });
}
