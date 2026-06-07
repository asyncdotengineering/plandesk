import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('App', () => {
  it('renders the Plan Desk heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /plan desk/i }).textContent).toBe('Plan Desk');
  });

  it('does not render a missing heading', () => {
    render(<App />);
    expect(screen.queryByRole('heading', { name: /missing/i })).toBeNull();
  });
});
