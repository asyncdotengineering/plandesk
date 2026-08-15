import { describe, expect, it } from 'vitest';
import { buildSkillMarkdown } from './connect-artifacts.js';

const PLANDESK_SKILL_TEMPLATE = buildSkillMarkdown();

describe('PLANDESK_SKILL_TEMPLATE task creation section', () => {
  const afterTaskCreation = PLANDESK_SKILL_TEMPLATE.split('## Task creation')[1];
  if (afterTaskCreation === undefined) {
    throw new Error('missing Task creation section');
  }
  const taskCreationSection = afterTaskCreation.split('## Documents')[0];
  if (taskCreationSection === undefined) {
    throw new Error('missing Documents section after Task creation');
  }

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
