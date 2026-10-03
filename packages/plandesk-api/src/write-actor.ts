import type { AuthContext } from './auth-context.js';

export type WriteActor =
  | { kind: 'human'; userId: string }
  | { kind: 'agent'; runId: string }
  | { kind: 'system' };

export class WriteActorUnresolvedError extends Error {
  constructor() {
    super('write actor could not be resolved from auth context');
    this.name = 'WriteActorUnresolvedError';
  }
}

export function serializeActor(actor: WriteActor): string {
  switch (actor.kind) {
    case 'human':
      return `human:${actor.userId}`;
    case 'agent':
      return `agent:${actor.runId}`;
    case 'system':
      return 'system';
  }
}

/** Resolve the write actor for an org-bearing auth context. Never defaults to system. */
export function resolveWriteActorFromAuthContext(ctx: AuthContext): WriteActor {
  switch (ctx.kind) {
    case 'session':
      return { kind: 'human', userId: ctx.userId };
    case 'loopback':
      return { kind: 'system' };
    case 'apikey':
      if (ctx.profile === 'owner') {
        return { kind: 'human', userId: ctx.userId };
      }
      if (ctx.agentRunId !== undefined) {
        return { kind: 'agent', runId: ctx.agentRunId };
      }
      throw new WriteActorUnresolvedError();
    case 'guest':
      throw new WriteActorUnresolvedError();
  }
}
