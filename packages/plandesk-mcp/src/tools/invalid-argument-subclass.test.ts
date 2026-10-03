import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '@plandesk/db';
import type { Services } from '@plandesk/api';
import { toolHandler } from '../../../plandesk-api/test-support/mcp-tool-handlers.js';

describe('InvalidArgumentError → MCP invalid_argument', () => {
  it('maps a new InvalidArgumentError subclass centrally, with no per-tool code', async () => {
    class InvalidWidgetError extends InvalidArgumentError {
      constructor() {
        super('widget must be blue', 'color');
        this.name = 'InvalidWidgetError';
      }
    }
    const services = {
      folderService: {
        create: () => Promise.reject(new InvalidWidgetError()),
      },
    } as unknown as Services;

    expect(
      await toolHandler('create_folder', services)({ project_id: 'p', name: 'F' }),
    ).toStrictEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'invalid_argument', message: 'widget must be blue' }),
        },
      ],
      isError: true,
    });
  });
});
