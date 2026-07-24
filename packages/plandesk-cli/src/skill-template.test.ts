import { describe, expect, it } from 'vitest';
import { PLANDESK_SKILL_TEMPLATE } from './skill-template.js';

describe('PLANDESK_SKILL_TEMPLATE task creation section', () => {
  const taskCreationSection = PLANDESK_SKILL_TEMPLATE.split('## Task creation')[1]!.split(
    '## Documents',
  )[0]!;

  it('names build-contract depth for non-trivial task descriptions', () => {
    expect(taskCreationSection).toMatch(/build-contract depth/i);
    expect(taskCreationSection).toMatch(/\*\*Interfaces\*\*/);
    expect(taskCreationSection).toMatch(/\*\*Pseudocode\*\*/);
    expect(taskCreationSection).toMatch(/\*\*Validation contract\*\*/);
  });

  it('requires descriptions to stay consumer-clean of internal RFC/PRD/ticket references', () => {
    expect(taskCreationSection).toMatch(/consumer-clean/i);
    expect(taskCreationSection).toMatch(/no internal RFC\/PRD\/ticket references/i);
  });
});
