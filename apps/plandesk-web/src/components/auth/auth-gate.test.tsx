import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './AccountMenu.js';
import { AuthGate } from './AuthGate.js';

type FetchArgs = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const loopbackSession = {
  kind: 'loopback' as const,
  user_ref: null,
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Personal' },
};

const browserSession = {
  kind: 'session' as const,
  user_ref: 'github:1',
  role: 'editor' as const,
  org: { id: 'org-2', name: 'Acme' },
};

function stubFetch(handler: (args: FetchArgs) => unknown) {
  const calls: FetchArgs[] = [];
  const doFetch = vi.fn((input: unknown, init?: RequestInit) => {
    const args = { url: String(input), init };
    calls.push(args);
    return handler(args);
  });
  vi.stubGlobal('fetch', doFetch);
  return calls;
}

function renderWith(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuthGate', () => {
  it('shows sign-in on 401 rather than an error', async () => {
    stubFetch(({ url }) => {
      if (url.endsWith('/auth/session')) {
        return jsonResponse({ error: 'unauthorized' }, 401);
      }
      if (url.endsWith('/auth/methods')) {
        return jsonResponse({ method: 'token', githubEnabled: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderWith(
      <AuthGate>
        <p>Secret board</p>
      </AuthGate>,
    );

    expect(await screen.findByText('Sign in to Plan Desk')).toBeDefined();
    expect(screen.queryByText('Secret board')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts better-auth GitHub social sign-in when githubEnabled (BA4c)', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });

    const calls = stubFetch(({ url }) => {
      if (url.endsWith('/auth/session')) {
        return jsonResponse({ error: 'unauthorized' }, 401);
      }
      if (url.endsWith('/auth/methods')) {
        return jsonResponse({ method: 'token', githubEnabled: true });
      }
      if (url === '/api/auth/sign-in/social') {
        return jsonResponse({ url: 'https://github.com/login/oauth/authorize?x=1', redirect: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderWith(
      <AuthGate>
        <p>Secret board</p>
      </AuthGate>,
    );

    const button = await screen.findByRole('button', { name: /continue with github/i });
    button.click();

    await waitFor(() => {
      const social = calls.find((c) => c.url === '/api/auth/sign-in/social');
      expect(social?.init?.method).toBe('POST');
      expect(social?.init?.credentials).toBe('include');
      expect(social?.init?.body).toBe(
        JSON.stringify({ provider: 'github', callbackURL: '/' }),
      );
      expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?x=1');
    });
  });

  it('falls back to token guidance when the instance has no GitHub app (REQ-20)', async () => {
    stubFetch(({ url }) => {
      if (url.endsWith('/auth/session')) {
        return jsonResponse({ error: 'unauthorized' }, 401);
      }
      return jsonResponse({ method: 'token', githubEnabled: false });
    });

    renderWith(
      <AuthGate>
        <p>Secret board</p>
      </AuthGate>,
    );

    expect(await screen.findByText(/does not use GitHub sign-in/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /continue with github/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /continue with github/i })).toBeNull();
  });

  it('renders the app for an authenticated caller', async () => {
    stubFetch(() => jsonResponse(browserSession));

    renderWith(
      <AuthGate>
        <p>Secret board</p>
      </AuthGate>,
    );

    expect(await screen.findByText('Secret board')).toBeDefined();
    expect(screen.queryByText('Sign in to Plan Desk')).toBeNull();
  });

  it('sends credentials so the HttpOnly session cookie rides along', async () => {
    const calls = stubFetch(() => jsonResponse(browserSession));

    renderWith(
      <AuthGate>
        <p>Secret board</p>
      </AuthGate>,
    );
    await screen.findByText('Secret board');

    const sessionCall = calls.find((c) => c.url.endsWith('/auth/session'));
    expect(sessionCall?.init?.credentials).toBe('include');
  });
});

describe('AccountMenu', () => {
  it('shows the current org and role', async () => {
    stubFetch(() => jsonResponse(browserSession));
    renderWith(<AccountMenu />);

    expect(await screen.findByText('Acme')).toBeDefined();
    expect(await screen.findByText('editor')).toBeDefined();
  });

  it('offers sign-out for a browser session', async () => {
    stubFetch(() => jsonResponse(browserSession));
    renderWith(<AccountMenu />);

    expect(await screen.findByRole('button', { name: /sign out/i })).toBeDefined();
  });

  it('offers no sign-out in local mode — there is no session to end (REQ-21)', async () => {
    stubFetch(() => jsonResponse(loopbackSession));
    renderWith(<AccountMenu />);

    expect(await screen.findByText('Personal')).toBeDefined();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
  });

  it('posts to better-auth sign-out when signing out', async () => {
    const calls = stubFetch(({ url }) => {
      if (url === '/api/auth/sign-out') {
        return jsonResponse({ success: true });
      }
      return jsonResponse(browserSession);
    });

    renderWith(<AccountMenu />);
    (await screen.findByRole('button', { name: /sign out/i })).click();

    await waitFor(() => {
      const logoutCall = calls.find((c) => c.url === '/api/auth/sign-out');
      expect(logoutCall?.init?.method).toBe('POST');
      expect(logoutCall?.init?.credentials).toBe('include');
    });
  });
});
