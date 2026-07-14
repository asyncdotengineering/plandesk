import type { Db } from '@plandesk/db';
import { createToken, ensureDefaultOrg } from '@plandesk/db';

export async function runTokenCreate(db: Db, name: string): Promise<string> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('token name is required');
  }
  const org = await ensureDefaultOrg(db);
  const { token } = await createToken(db, { name: trimmed, orgId: org.id });
  return token;
}
