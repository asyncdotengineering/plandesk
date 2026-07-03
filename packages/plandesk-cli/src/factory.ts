import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { globalDirRefusalReason, insertFactorySentinelBlock } from './connect-artifacts.js';
import { resolveAgents } from './connect.js';

export class FactoryError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'FactoryError';
  }
}

export type FactoryInitOptions = {
  repoDir: string;
  print?: boolean;
  force?: boolean;
  /** Injectable for tests; defaults to os.homedir() inside the guard. */
  homeDir?: string;
};

export type FactoryArtifact = {
  path: string;
  content: string;
  action: 'create' | 'update' | 'skip';
};

export type FactoryInitResult = {
  repoDir: string;
  artifacts: FactoryArtifact[];
};

export const FACTORY_DIR = '.agents/factory';

export function buildAgentsIndexMarkdown(): string {
  return `# Agent workspace

Harness-neutral agent artifacts for this repository, discovered by path.
Consumers must tolerate unknown types, unknown frontmatter keys, and links to
not-yet-written files.

- [factory/workflow.md](factory/workflow.md) - the orchestrator's session program (shipped default)
- [factory/factory.md](factory/factory.md) - the factory contract: how delegated agent work cycles run here
- [factory/protocol.md](factory/protocol.md) - the deterministic dispatch + result contract for worker CLIs
- [factory/workers/](factory/workers/) - one file per worker: probe (is it installed?) + command template
- [factory/lanes.md](factory/lanes.md) - risk-lane policy: which changes need which human gates
- [factory/verifiers/](factory/verifiers/) - fast per-change checks (exit 0 = pass)
- [skills/](skills/) - Agent Skills (SKILL.md directories) usable by any harness
`;
}

export function buildFactoryMarkdown(): string {
  return `---
type: factory
version: 1
---

# Factory contract

How delegated agent work cycles run in this repository. The bound Plan Desk
project is the scheduler and the single source of truth for work items; this
file is the policy the supervising agent follows.

## The cycle (one work item)

1. **Pull** — \`get_next_task\` on the bound project. Only \`todo\` tasks whose
   prerequisites are all \`done\` are workable; \`scope\` and \`backlog\` wait
   for a human to release them on the board.
2. **Read** — the task's linked spec document before touching anything.
3. **Red gate** — run the relevant verifier or gate command. If it is already
   green, demand a discriminative failing check first, or send the task back
   to \`scope\` with a comment. Green-at-start proves nothing.
4. **Act** — dispatch to an installed worker from [workers/](workers/) per
   [protocol.md](protocol.md): probe first, then the file's command template.
5. **Prove** — verify the worker's result claims per the protocol (re-run the
   claimed commands; exit codes are authoritative). No valid claims, no done.
6. **Observe** — read the diff (the hunks, not the worker transcript) before
   any status change.
7. **Gate** — apply the task's lane from [lanes.md](lanes.md): \`auto\`
   proceeds, \`approve\` waits on a human resolving the diff-summary comment,
   \`full\` runs an independent review plus a human.
8. **Report** — flip the task to \`done\` atomically with the verification and
   append one line to \`runs/metrics.jsonl\` (cost, duration, lane, worker,
   verdicts).

## Conventions

- Statuses flip atomically with the work event, never in batches.
- Review blockers become tasks with blocking edges — the board always shows
  why work is stuck.
- If a change balloons past its triaged complexity, the task goes back to
  \`scope\` with a comment explaining why.
- \`runs/\` is transient machine state (gitignored). Everything else under
  \`.agents/\` is authored policy — edit it, commit it, own it.
`;
}

export type WorkerTemplate = {
  name: string;
  probe: string;
  command: string;
  body: string;
};

// One file per worker; the filename is the worker's name. `probe` decides
// availability on THIS machine at dispatch time — the scaffold never assumes
// a CLI is installed. `command` is a template: the supervisor substitutes
// {prompt_file} and runs it verbatim; the model never re-derives invocation
// flags from memory.
export const WORKER_TEMPLATES: WorkerTemplate[] = [
  {
    name: 'claude',
    probe: 'command -v claude',
    command: 'claude --dangerously-skip-permissions -p < {prompt_file}',
    body: `Default implementation worker. Uses the session-default model; append
\`--model sonnet\` (the alias, not a dated id) to pin standard-context Sonnet.`,
  },
  {
    name: 'codex',
    probe: 'command -v codex',
    command: 'codex exec --full-auto < {prompt_file}',
    body: `Adversarial review and live-smoke worker — prefer it as the reviewer
when the act worker is a Claude-family run. Verify flags against your
installed version (\`codex --help\`).`,
  },
  {
    name: 'cursor',
    probe: 'command -v cursor-agent',
    command:
      'cursor-agent -p --force --trust --model auto --sandbox disabled --approve-mcps < {prompt_file}',
    body: `Alternative implementation worker with per-turn model routing. Keep
\`--model auto\`; never pin a model on Cursor for unsupervised work.`,
  },
  {
    name: 'grok',
    probe: 'command -v grok',
    command: 'grok --prompt-file {prompt_file} --always-approve --output-format plain',
    body: `Fast implementation worker. Pin a model with \`--model <id>\` after
checking \`grok models\` for what is installed here.`,
  },
  {
    name: 'opencode',
    probe: 'command -v opencode',
    command: 'opencode run < {prompt_file}',
    body: `End-to-end implementation worker. Verify flags against your installed
version (\`opencode --help\`).`,
  },
];

export function buildWorkerMarkdown(worker: WorkerTemplate): string {
  return `---
type: worker
probe: ${worker.probe}
command: ${worker.command}
---

# ${worker.name}

${worker.body}

Dispatch rule: run \`probe\` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run \`command\` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).
`;
}

export function buildProtocolMarkdown(): string {
  return `---
type: protocol
version: 1
---

# Dispatch protocol

The deterministic contract between the supervising agent (the engine) and any
worker CLI. There is no SDK binding: the only contract is files in, one JSON
shape out — any CLI agent that can follow instructions satisfies it.

## Dispatch (engine side)

1. Pick a worker file from [workers/](workers/) whose \`probe\` exits 0 on this
   machine. Never assume a worker exists; never invoke flags from memory —
   only the file's \`command\` template, with \`{prompt_file}\` substituted.
2. Write the brief to \`runs/brief-<task>.md\`: the task, its spec, the gate
   command(s) to satisfy, and the result contract below.
3. Run the command. One process per dispatch, headless, from the repo root.

## Result (worker side)

The brief instructs the worker to end by writing \`runs/result-<task>.json\`:

\`\`\`json
{
  "status": "done | blocked",
  "claims": [{ "command": "<gate or check run>", "exit_code": 0 }],
  "question": "<only when blocked: what decision or input is needed>"
}
\`\`\`

## Verification (engine side — deterministic, no model judgment)

- \`status: done\` with no \`claims\` is invalid — treat as failed.
- Re-run each claimed command; a claim whose re-run exit code differs from the
  claimed one is a false claim — treat the dispatch as failed, record it, and
  do not retry the same approach blindly.
- Only after claims verify does the engine read the diff and apply the lane
  gate from [lanes.md](lanes.md).

Exit codes are authoritative. Model output is metadata.
`;
}

export function buildLanesMarkdown(): string {
  return `---
type: lanes
---

# Risk lanes

Every work item gets a lane at intake, decided by blast radius. Gates are
loosened per lane only when the metrics ledger justifies it — cite the
evidence when you loosen one.

| lane    | applies to                                      | gate                                                  |
| ------- | ----------------------------------------------- | ----------------------------------------------------- |
| auto    | isolated, low-blast-radius changes (copy, docs) | proof + verifiers only — no human                     |
| approve | routine feature work                            | diff summary posted as a comment; a human resolves it |
| full    | schema, infra, auth, public contracts           | independent review + human approval                   |

The human who releases or merges a change owns the outcome.
`;
}

export function buildExampleVerifierMarkdown(): string {
  return `---
type: verifier
command: npm test
enabled: false
---

# Tests pass

Example verifier. A verifier is a fast, deterministic per-change check:
\`command\` runs from the repo root and exit code 0 means pass. One check per
file; the filename is the verifier's name. Set \`enabled: true\` (or delete
this file and add your own) once the command matches this repository.
`;
}

export function buildRunsGitignore(): string {
  return `*
!.gitignore
`;
}

export function buildWorkflowMarkdown(): string {
  return `---
type: workflow
version: 1
---

# Orchestrator workflow

The session program for an agent asked to work this repository: what happens
from "work on this repo" to the final report. [factory.md](factory.md) governs
each work item; this file governs the session. Shipped default — this file is
owned by the repository (see the Factory workspace docs for customizing).

## 1. Orient

- Read [../index.md](../index.md), this file, and [factory.md](factory.md).
- Reconcile the board against reality (recent commits, working tree): fix any
  status that drifted before starting new work.
- Pull open comments (\`list_comments\`); address or acknowledge them first.

## 2. Intake (only when asked to plan)

- New idea or RFC → \`scaffold_project_from_plan\`: a task per unit of work
  (\`todo\`/\`scope\`), dependency edges, a \`Design:\` doc on the first task.
- Assign each task a lane from [lanes.md](lanes.md) at creation.
- Then stop — humans release \`scope\` → \`todo\` on the board.

## 3. Execute (the default mode)

- \`start_agent_run\`, then loop the [factory.md](factory.md) cycle over
  \`get_next_task\` until nothing is actionable or a gate blocks.
- One task at a time; serial within a project.
- \`record_agent_progress\` every cycle. Blockers become tasks or comments —
  never a silent stop.

## 4. Finish

- \`complete_agent_run\`. Report at diff level: what shipped, what is gated on
  a human, what failed and why. Leave the board true.
`;
}

export function buildFactoryCommandMarkdown(): string {
  return `# Factory

@.agents/factory/workflow.md

@.agents/factory/factory.md
`;
}

export function buildFactoryArtifacts(repoDir: string): FactoryArtifact[] {
  const artifacts: FactoryArtifact[] = [];
  const factoryDir = join(repoDir, FACTORY_DIR);

  // Authored policy files: created once, then owned and edited by the user.
  const authored: Array<{ path: string; content: string }> = [
    { path: join(repoDir, '.agents', 'index.md'), content: buildAgentsIndexMarkdown() },
    { path: join(factoryDir, 'workflow.md'), content: buildWorkflowMarkdown() },
    { path: join(factoryDir, 'factory.md'), content: buildFactoryMarkdown() },
    { path: join(factoryDir, 'protocol.md'), content: buildProtocolMarkdown() },
    { path: join(factoryDir, 'lanes.md'), content: buildLanesMarkdown() },
    { path: join(factoryDir, 'verifiers', 'tests-pass.md'), content: buildExampleVerifierMarkdown() },
    { path: join(factoryDir, 'runs', '.gitignore'), content: buildRunsGitignore() },
    ...WORKER_TEMPLATES.map((worker) => ({
      path: join(factoryDir, 'workers', `${worker.name}.md`),
      content: buildWorkerMarkdown(worker),
    })),
  ];
  for (const file of authored) {
    artifacts.push({
      path: file.path,
      content: file.content,
      action: existsSync(file.path) ? 'skip' : 'create',
    });
  }

  // Always-on policy include: workflow.md + factory.md are POLICY — they must
  // ride in default context to gate behavior (a pointer the agent may not
  // follow is not a gate). Managed sentinel block, regenerated idempotently.
  const claudeMdPath = join(repoDir, 'CLAUDE.md');
  const existingClaudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : '';
  artifacts.push({
    path: claudeMdPath,
    content: insertFactorySentinelBlock(existingClaudeMd),
    action: existsSync(claudeMdPath) ? 'update' : 'create',
  });
  const agentsMdPath = join(repoDir, 'AGENTS.md');
  if (existsSync(agentsMdPath)) {
    artifacts.push({
      path: agentsMdPath,
      content: insertFactorySentinelBlock(readFileSync(agentsMdPath, 'utf8')),
      action: 'update',
    });
  }

  // Generated command adapters: regenerated on every run. An adapter we wrote
  // on a previous run counts as evidence the harness is in use — detection
  // must not flip just because the first run created sibling directories.
  const agents = resolveAgents(repoDir, 'detect');
  const claudeCommandPath = join(repoDir, '.claude', 'commands', 'factory.md');
  const codexCommandPath = join(repoDir, '.codex', 'commands', 'factory.md');
  if (agents.claude || existsSync(claudeCommandPath)) {
    artifacts.push({
      path: claudeCommandPath,
      content: buildFactoryCommandMarkdown(),
      action: existsSync(claudeCommandPath) ? 'update' : 'create',
    });
  }
  if (agents.codex || existsSync(codexCommandPath)) {
    artifacts.push({
      path: codexCommandPath,
      content: buildFactoryCommandMarkdown(),
      action: existsSync(codexCommandPath) ? 'update' : 'create',
    });
  }

  return artifacts;
}

function writeFactoryArtifacts(artifacts: FactoryArtifact[]): void {
  for (const artifact of artifacts) {
    if (artifact.action === 'skip') {
      continue;
    }
    mkdirSync(dirname(artifact.path), { recursive: true });
    writeFileSync(artifact.path, artifact.content, 'utf8');
  }
}

export function runFactoryInit(options: FactoryInitOptions): FactoryInitResult {
  const repoDir = resolve(options.repoDir);

  const refusal = globalDirRefusalReason(repoDir, options.homeDir);
  if (refusal !== undefined && options.force !== true) {
    throw new FactoryError(
      `Refusing to scaffold in ${refusal}: agent config written here leaks into every project on this machine. ` +
        `Run from a project repository (or pass --force if you really mean it).`,
    );
  }

  const artifacts = buildFactoryArtifacts(repoDir);

  if (options.print !== true) {
    writeFactoryArtifacts(artifacts);
  }

  return { repoDir, artifacts };
}

export function formatFactoryInitSummary(result: FactoryInitResult): string {
  const lines: string[] = [];
  lines.push(`Factory workspace ready at ${join(result.repoDir, '.agents')}`);
  for (const artifact of result.artifacts) {
    lines.push(`${artifact.action}: ${artifact.path}`);
  }
  lines.push(
    'Edit .agents/factory/ (factory.md, lanes.md, workers/*.md) to fit this repo — they are yours now (skip = kept your version).',
  );
  return `${lines.join('\n')}\n`;
}

export function formatFactoryInitPrint(result: FactoryInitResult): string {
  const lines: string[] = [];
  lines.push('# plandesk factory init --print');
  lines.push(`repo: ${result.repoDir}`);
  lines.push('');
  for (const artifact of result.artifacts) {
    lines.push(`--- ${artifact.action.toUpperCase()} ${artifact.path}`);
    if (artifact.action !== 'skip') {
      lines.push(artifact.content);
    }
  }
  return `${lines.join('\n')}\n`;
}
