import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './CommandMenu.js';

describe('CommandMenu', () => {
  it('includes Documents in the Navigate group', () => {
    const labels = NAV_ITEMS.map((item) => item.label);
    expect(labels).toContain('Documents');
  });
});
