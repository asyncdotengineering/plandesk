import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from '../../test-utils.js';
import { CanvasModeProvider } from './CanvasModeContext.js';
import { FrameRegistryProvider } from './FrameRegistryContext.js';
import { PrototypeChrome, coverageLabel } from './PrototypeChrome';
import { ScreenCommentsProvider } from './ScreenCommentsContext.js';
import { ScreenDiagnosticsProvider } from './ScreenDiagnosticsContext.js';

function renderChrome() {
  return render(
    <ScreenDiagnosticsProvider>
      <ScreenCommentsProvider>
        <FrameRegistryProvider>
          <CanvasModeProvider>
            <PrototypeChrome prototypeId="proto-1" name="Checkout" />
          </CanvasModeProvider>
        </FrameRegistryProvider>
      </ScreenCommentsProvider>
    </ScreenDiagnosticsProvider>,
  );
}

describe('PrototypeChrome', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ({
        ok: true,
        status: 201,
        json: () => ({
          url: 'http://127.0.0.1:3456/p/tok',
          markdown_url: 'http://127.0.0.1:3456/api/v1/share/tok.md',
          expires_at: null,
        }),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exposes a share action that mints a prototype share link', async () => {
    renderChrome();
    expect(screen.getByText('Checkout')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /share prototype/i }));
    fireEvent.click(await screen.findByRole('button', { name: /create link/i }));

    await screen.findByDisplayValue('http://127.0.0.1:3456/p/tok');
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => requestUrl(url).includes('/prototypes/proto-1/share'));
    expect(call).toBeTruthy();
    expect(call?.[1]?.method).toBe('POST');
  });

  it('shows the mode selector defaulting to Arrange', () => {
    renderChrome();
    const chrome = document.querySelector('[data-prototype-chrome]');
    expect(chrome?.getAttribute('data-canvas-mode')).toBe('arrange');
    expect(screen.getByRole('radio', { name: 'Arrange' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Interact' }));
    expect(chrome?.getAttribute('data-canvas-mode')).toBe('interact');
  });

  it('shows named missing screens once the coverage badge is opened', () => {
    render(
      <ScreenDiagnosticsProvider>
        <ScreenCommentsProvider>
          <FrameRegistryProvider>
            <CanvasModeProvider>
              <PrototypeChrome
                prototypeId="proto-1"
                name="Checkout"
                coverage={{
                  parseable: true,
                  parse_error: null,
                  planned: ['A', 'B', 'C'],
                  built: ['A', 'B'],
                  missing: ['C'],
                  unplanned: [],
                  states_unverified: [],
                  unplanned_note: null,
                }}
              />
            </CanvasModeProvider>
          </FrameRegistryProvider>
        </ScreenCommentsProvider>
      </ScreenDiagnosticsProvider>,
    );
    expect(document.querySelector('[data-coverage-detail]')).toBeNull();
    expect(screen.getByRole('button', { name: /flow coverage/i }).textContent).toContain('2/3');

    fireEvent.click(screen.getByRole('button', { name: /flow coverage/i }));
    expect(screen.getByText('C')).toBeTruthy();
  });

  it('counts screens rather than printing a 4/0 fraction when nothing is planned', () => {
    expect(
      coverageLabel({
        parseable: true,
        parse_error: null,
        planned: [],
        built: ['A', 'B', 'C', 'D'],
        missing: [],
        unplanned: ['A', 'B', 'C', 'D'],
        states_unverified: [],
        unplanned_note: null,
      }),
    ).toBe('4 screens');
  });

  it('says unparseable when the flow document has no screens table', () => {
    render(
      <ScreenDiagnosticsProvider>
        <ScreenCommentsProvider>
          <FrameRegistryProvider>
            <CanvasModeProvider>
              <PrototypeChrome
                prototypeId="proto-1"
                name="Checkout"
                coverage={{
                  parseable: false,
                  parse_error: 'no screens table found',
                  planned: [],
                  built: [],
                  missing: [],
                  unplanned: [],
                  states_unverified: [],
                  unplanned_note: null,
                }}
              />
            </CanvasModeProvider>
          </FrameRegistryProvider>
        </ScreenCommentsProvider>
      </ScreenDiagnosticsProvider>,
    );
    expect(screen.getByRole('button', { name: /flow coverage/i }).textContent).toContain(
      'Flow unparseable',
    );
    fireEvent.click(screen.getByRole('button', { name: /flow coverage/i }));
    expect(screen.getByText(/no screens table found/i)).toBeTruthy();
  });

  it('renders a route-supplied back link', () => {
    render(
      <ScreenDiagnosticsProvider>
        <ScreenCommentsProvider>
          <FrameRegistryProvider>
            <CanvasModeProvider>
              <PrototypeChrome
                prototypeId="proto-1"
                name="Checkout"
                backSlot={<a href="/projects/p1/prototypes">Prototypes</a>}
              />
            </CanvasModeProvider>
          </FrameRegistryProvider>
        </ScreenCommentsProvider>
      </ScreenDiagnosticsProvider>,
    );
    expect(screen.getByRole('link', { name: 'Prototypes' })).toBeTruthy();
  });
});
