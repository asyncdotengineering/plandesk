import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ArtifactView } from './ArtifactView.js';
import { artifactRenderSrc } from '../../lib/artifact-frame.js';
import * as sanitize from '../../lib/sanitize.js';

const HTML_REPORT = {
  id: '00000000-0000-4000-8000-0000000000a1',
  title: 'Q3 Report',
  kind: 'html' as const,
  folder_id: null,
  prototype_id: null,
  revision_id: 'rev-1',
  updated_at: '2026-08-16T00:00:00.000Z',
};

afterEach(cleanup);

const MARKDOWN_NOTE = {
  ...HTML_REPORT,
  id: '00000000-0000-4000-8000-0000000000a2',
  kind: 'markdown' as const,
};

describe('ArtifactView', () => {
  it('renders an HTML artifact in a sandboxed frame, never as inline markup', () => {
    render(<ArtifactView artifact={HTML_REPORT} body="<style>.a{color:red}</style><p>x</p>" />);

    const frame = screen.getByTitle('Q3 Report');
    expect(frame.tagName).toBe('IFRAME');
    // allow-same-origin would let the page reach the parent document; the CSP
    // on the render route is only half the boundary.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe(artifactRenderSrc(HTML_REPORT.id, 'rev-1'));
  });

  it('never routes HTML artifact content through the rich-text sanitizer', () => {
    const spy = vi.spyOn(sanitize, 'sanitizeHtml');
    render(<ArtifactView artifact={HTML_REPORT} body="<style>.a{color:red}</style>" />);
    // DOMPurify's html profile strips <style>, <script> and <svg> — exactly what
    // a report is made of. The frame is the boundary here, not the sanitizer.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('renders a markdown artifact as read-only text with no frame', () => {
    render(<ArtifactView artifact={MARKDOWN_NOTE} body={'## Findings\n\nAll clear.'} />);

    expect(screen.queryByTitle('Q3 Report')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeTruthy();
  });

  it('busts the frame cache on the revision, so a re-pushed artifact is not stale', () => {
    const { rerender } = render(<ArtifactView artifact={HTML_REPORT} body="" />);
    const first = screen.getByTitle('Q3 Report').getAttribute('src');

    rerender(<ArtifactView artifact={{ ...HTML_REPORT, revision_id: 'rev-2' }} body="" />);
    expect(screen.getByTitle('Q3 Report').getAttribute('src')).not.toBe(first);
  });
});

describe('artifactRenderSrc', () => {
  it('points at the render route and carries the revision', () => {
    expect(artifactRenderSrc('abc', 'rev-1')).toBe('/api/v1/artifacts/abc/render?v=rev-1');
  });

  it('carries a frame token when one is supplied, for share-scoped reads', () => {
    expect(artifactRenderSrc('abc', 'rev-1', 'tok en')).toBe(
      '/api/v1/artifacts/abc/render?token=tok%20en&v=rev-1',
    );
  });
});
