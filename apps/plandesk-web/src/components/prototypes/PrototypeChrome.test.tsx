import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from '../../test-utils.js';
import { CanvasModeProvider } from './CanvasModeContext.js';
import { FrameRegistryProvider } from './FrameRegistryContext.js';
import { PrototypeChrome } from './PrototypeChrome';
import { ScreenDiagnosticsProvider } from './ScreenDiagnosticsContext.js';

function renderChrome() {
  return render(
    <ScreenDiagnosticsProvider>
      <FrameRegistryProvider>
        <CanvasModeProvider>
          <PrototypeChrome prototypeId="proto-1" name="Checkout" />
        </CanvasModeProvider>
      </FrameRegistryProvider>
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
});
