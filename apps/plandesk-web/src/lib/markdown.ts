import {
  convertDocumentBody,
  type WikiLinkResolver,
} from '@plandesk/api/markdown';

const HTML_BODY_RE = /^\s*<(?:[a-z][\w-]*)(?:\s|>|\/)/i;

export type BodyToHtmlOptions = {
  resolve?: WikiLinkResolver;
  projectId?: string;
};

// Bodies are stored as HTML, but documents written by agents before the MCP
// server converted Markdown (and any future plain-Markdown writes) should
// still render as rich text instead of a collapsed blob.
export function bodyToHtml(body: string, options: BodyToHtmlOptions = {}): string {
  if (body.trim() === '' || HTML_BODY_RE.test(body)) {
    return body;
  }
  return convertDocumentBody(body, options).html;
}
