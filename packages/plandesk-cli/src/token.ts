import type { Db } from '@plandesk/db';
import { createToken } from '@plandesk/db';

export async function runTokenCreate(db: Db, name: string): Promise<string> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('token name is required');
  }
  const { token } = await createToken(db, { name: trimmed });
  return token;
}
