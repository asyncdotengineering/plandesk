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

function section(heading: string, next: string): string {
  const after = PLANDESK_SKILL_TEMPLATE.split(`## ${heading}\n`)[1];
  if (after === undefined) {
    throw new Error(`missing ${heading} section`);
  }
  return after.split(`## ${next}\n`)[0] ?? '';
}

// An agent working only from this file must get each call right the first
// time; the parameter names are not guessable from the neighbouring tools.
describe('PLANDESK_SKILL_TEMPLATE carries real tool signatures', () => {
  it('states the agent-run lifecycle signatures', () => {
    const runs = section('Agent runs', 'Never do');
    expect(runs).toContain('start_agent_run(project_id, label?)');
    expect(runs).toContain('record_agent_progress(run_id, message)');
    expect(runs).toContain("complete_agent_run(run_id, status: 'completed' | 'failed')");
  });

  it('shows add_comment by target, on a task as well as a document', () => {
    const comments = section('Comments', 'Reviewing files (the CLI previewer)');
    expect(comments).toContain('add_comment(target_type, target_id, body, passage?)');
    expect(comments).toMatch(/target_type: 'task'/);
  });

  it('says how far a share link reaches and that it is a bearer URL', () => {
    const sharing = section('Sharing', 'Prototypes');
    expect(sharing).toContain('reachable_from');
    expect(sharing).toContain('PLANDESK_BASE_URL');
    expect(sharing).toMatch(/bearer/i);
  });
});
