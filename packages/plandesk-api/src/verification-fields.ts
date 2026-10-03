import { InvalidArgumentError } from '@plandesk/db';
export class InvalidVerificationError extends InvalidArgumentError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVerificationError';
  }
}

export type ParsedVerificationFields = {
  verifiedAt?: Date | null;
  verifiedRef?: string | null;
};

export function parseVerificationInput(input: {
  verified_at?: string | null;
  verified_ref?: string | null;
}): ParsedVerificationFields {
  const hasAt = input.verified_at !== undefined;
  const hasRef = input.verified_ref !== undefined;
  if (!hasAt && !hasRef) {
    return {};
  }

  // A ref names what was verified at a time: it never exists without one.
  const setsRef = hasRef && input.verified_ref !== null;
  if (setsRef && (input.verified_at === undefined || input.verified_at === null)) {
    throw new InvalidVerificationError('verified_at is required when setting verified_ref');
  }

  const out: ParsedVerificationFields = {};
  if (hasAt) {
    const verifiedAt = input.verified_at;
    if (verifiedAt === null) {
      // Un-verifying clears the ref with it, so no orphaned ref survives.
      out.verifiedAt = null;
      out.verifiedRef = null;
    } else if (verifiedAt === undefined) {
      // hasAt guarantees this branch is unreachable; satisfies strict narrowing.
    } else {
      const parsed = new Date(verifiedAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new InvalidVerificationError('verified_at must be a valid ISO 8601 timestamp');
      }
      out.verifiedAt = parsed;
    }
  }
  if (hasRef) {
    const verifiedRef = input.verified_ref;
    if (verifiedRef === null) {
      out.verifiedRef = null;
    } else if (verifiedRef === undefined) {
      // hasRef guarantees this branch is unreachable; satisfies strict narrowing.
    } else if (verifiedRef.trim() === '') {
      throw new InvalidVerificationError('verified_ref must be a non-empty string');
    } else {
      out.verifiedRef = verifiedRef;
    }
  }
  return out;
}
