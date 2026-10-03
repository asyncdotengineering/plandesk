/**
 * Origin-parameterised CSP and prepend wrap for HTML screen artifacts.
 *
 * The policy names an explicit origin (not `'self'`) so img-src / script-src
 * survive a proxy or CDN in front of the API — `'self'` would resolve to the
 * proxy host. A browser spike (Chromium 151 / Firefox 153) showed `'self'`
 * *does* match in an opaque-origin framed document when the policy arrived as
 * a response header; the "matches nothing" rationale is stale.
 *
 * The CSP `sandbox` directive is required so a direct (unframed) navigation to
 * the render URL stays sandboxed — the iframe `sandbox` attribute alone does
 * not apply there.
 */

import { HTML_ARTIFACT_SHIM } from './html-frame-shim.js';

/** Injected frame bridge (modes, selection, navigate, wheel, highlight). */
export { HTML_ARTIFACT_SHIM };
/**
 * Build the HTML artifact Content-Security-Policy for a named origin.
 * The string always begins with the `sandbox` directive.
 */
export function htmlArtifactCsp(origin: string): string {
  return (
    `sandbox allow-scripts; ` +
    `default-src 'none'; ` +
    `img-src data: blob: ${origin}; ` +
    `style-src 'unsafe-inline'; ` +
    `script-src 'unsafe-inline' ${origin}; ` +
    `font-src data:; ` +
    `connect-src 'none'; ` +
    `base-uri 'none'; ` +
    `form-action 'none'`
  );
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Prepend meta CSP + shim ahead of untrusted content. Never string-replace
 * into the content — that no-ops without a literal `</body>` and can match
 * inside a script or attribute.
 *
 * Nothing artifact-derived is interpolated into the shim source.
 */
export function wrapHtmlArtifactForRender(content: string, csp: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttr(csp)}" />`;
  return `${meta}${HTML_ARTIFACT_SHIM}${content}`;
}
