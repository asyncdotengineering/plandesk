import type { Db } from '@plandesk/db';
import { createToken } from '@plandesk/db';

export function runTokenCreate(db: Db, name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('token name is required');
  }
  const { token } = createToken(db, { name: trimmed });
  return token;
}
