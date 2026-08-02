import { describe, expect, it } from 'vitest';
import {
  HTML_ARTIFACT_SHIM_STUB,
  htmlArtifactCsp,
  resolveRenderOrigin,
  wrapHtmlArtifactForRender,
} from './html-artifact.js';

describe('htmlArtifactCsp', () => {
  it('begins with the sandbox directive and names the origin in img-src and script-src', () => {
    const csp = htmlArtifactCsp('https://app.example');
    expect(csp.startsWith('sandbox allow-scripts;')).toBe(true);
    expect(csp).toContain('img-src data: blob: https://app.example');
    expect(csp).toContain("script-src 'unsafe-inline' https://app.example");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("'self'");
  });
});

describe('resolveRenderOrigin', () => {
  it('prefers PLANDESK_BASE_URL when set, stripping a trailing slash', () => {
    expect(
      resolveRenderOrigin(
        'http://request.example/api/v1/artifacts/x/render',
        'https://configured.example/',
      ),
    ).toBe('https://configured.example');
  });

  it('falls back to the request URL origin when env base is unset or blank', () => {
    expect(resolveRenderOrigin('http://127.0.0.1:7526/api/v1/artifacts/x/render', undefined)).toBe(
      'http://127.0.0.1:7526',
    );
    expect(resolveRenderOrigin('http://127.0.0.1:7526/api/v1/artifacts/x/render', '  ')).toBe(
      'http://127.0.0.1:7526',
    );
  });
});

describe('wrapHtmlArtifactForRender', () => {
  const origin = 'http://127.0.0.1:9';
  const csp = htmlArtifactCsp(origin);

  it('prepends meta + shim ahead of <!doctype html> content', () => {
    const content = '<!doctype html><html><body><p>hi</p></body></html>';
    const out = wrapHtmlArtifactForRender(content, csp);
    expect(out.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(out).toContain(`content="${csp}"`);
    const afterMeta = out.slice(out.indexOf('/>') + 2);
    expect(afterMeta.startsWith(HTML_ARTIFACT_SHIM_STUB)).toBe(true);
    expect(afterMeta.slice(HTML_ARTIFACT_SHIM_STUB.length)).toBe(content);
  });

  it('prepends when content has no </body>', () => {
    const content = '<h1>bare fragment</h1>';
    const out = wrapHtmlArtifactForRender(content, csp);
    expect(out.endsWith(content)).toBe(true);
    expect(out).toContain(HTML_ARTIFACT_SHIM_STUB);
    expect(out.indexOf(HTML_ARTIFACT_SHIM_STUB)).toBeLessThan(out.indexOf(content));
  });

  it('prepends when </body> appears only inside a <script> string', () => {
    const content =
      '<html><body><script>const s = "</body>"; document.write(s);</script></body></html>';
    const out = wrapHtmlArtifactForRender(content, csp);
    // Content bytes after the shim are byte-identical — no mid-content splice.
    expect(out.endsWith(content)).toBe(true);
    expect(out.indexOf(HTML_ARTIFACT_SHIM_STUB) + HTML_ARTIFACT_SHIM_STUB.length).toBe(
      out.length - content.length,
    );
  });

  it('does not interpolate artifact-derived text into the shim (</script> in title)', () => {
    const content =
      '<!doctype html><html><head><title></script><script>window.__pwned=1</script></title></head><body>x</body></html>';
    const out = wrapHtmlArtifactForRender(content, csp);
    const shimStart = out.indexOf(HTML_ARTIFACT_SHIM_STUB);
    expect(shimStart).toBeGreaterThan(0);
    expect(out.slice(shimStart, shimStart + HTML_ARTIFACT_SHIM_STUB.length)).toBe(
      HTML_ARTIFACT_SHIM_STUB,
    );
    // Hostile title remains only in the content region after the constant shim.
    expect(out.slice(shimStart + HTML_ARTIFACT_SHIM_STUB.length)).toBe(content);
  });
});
