import { describe, expect, it } from 'vitest';
import { reachOf, resolvePublicOrigin } from './public-origin.js';

describe('resolvePublicOrigin', () => {
  it('prefers PLANDESK_BASE_URL when set, stripping a trailing slash', () => {
    expect(
      resolvePublicOrigin(
        'http://request.example/api/v1/artifacts/x/render',
        'https://configured.example/',
      ),
    ).toBe('https://configured.example');
  });

  it('falls back to the request URL origin when env base is unset or blank', () => {
    expect(resolvePublicOrigin('http://127.0.0.1:7526/api/v1/artifacts/x/render', undefined)).toBe(
      'http://127.0.0.1:7526',
    );
    expect(resolvePublicOrigin('http://127.0.0.1:7526/api/v1/artifacts/x/render', '  ')).toBe(
      'http://127.0.0.1:7526',
    );
  });
});

describe('reachOf', () => {
  it('calls a loopback origin this-machine-only and anything else network', () => {
    expect(reachOf('http://127.0.0.1:7526')).toBe('this_machine');
    expect(reachOf('http://localhost:7526')).toBe('this_machine');
    expect(reachOf('http://[::1]:7526')).toBe('this_machine');
    expect(reachOf('http://192.168.1.20:7526')).toBe('network');
    expect(reachOf('https://board.example.com')).toBe('network');
  });
});
