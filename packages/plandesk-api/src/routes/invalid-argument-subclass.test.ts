import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '@plandesk/db';
import { createTestApp } from '../test-helpers.js';

describe('InvalidArgumentError → REST invalid_argument', () => {
  it('maps a new InvalidArgumentError subclass centrally, with no per-route code', async () => {
    class InvalidWidgetError extends InvalidArgumentError {
      constructor() {
        super('widget must be blue', 'color');
        this.name = 'InvalidWidgetError';
      }
    }
    const { app } = await createTestApp();
    app.post('/api/v1/__contract/widget', () => {
      throw new InvalidWidgetError();
    });
    const res = await app.request('/api/v1/__contract/widget', { method: 'POST' });
    expect({ status: res.status, text: await res.text() }).toEqual({
      status: 400,
      text: JSON.stringify({
        error: 'invalid_argument',
        field: 'color',
        message: 'widget must be blue',
      }),
    });
  });
});
