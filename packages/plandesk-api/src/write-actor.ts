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

export class InvalidActorSerializationError extends Error {
  constructor(value: string) {
    super(`invalid actor serialization: ${value}`);
    this.name = 'InvalidActorSerializationError';
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

export function parseActor(value: string): WriteActor {
  if (value === 'system') {
    return { kind: 'system' };
  }
  const colon = value.indexOf(':');
  if (colon === -1) {
    throw new InvalidActorSerializationError(value);
  }
  const kind = value.slice(0, colon);
  const id = value.slice(colon + 1);
  if (id.length === 0) {
    throw new InvalidActorSerializationError(value);
  }
  if (kind === 'human') {
    return { kind: 'human', userId: id };
  }
  if (kind === 'agent') {
    return { kind: 'agent', runId: id };
  }
  throw new InvalidActorSerializationError(value);
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
