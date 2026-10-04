import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from './external-url.js';

describe('safeExternalUrl', () => {
  it('drops userinfo so a redirect never shows a trusted-looking host before the real one', () => {
    expect(safeExternalUrl('https://cdn.example.com@evil.example/x.png')).toBe(
      'https://evil.example/x.png',
    );
    expect(safeExternalUrl('https://user:pass@files.example/a')).toBe('https://files.example/a');
  });
});
