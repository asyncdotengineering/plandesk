import { randomUUID } from 'node:crypto';
import type { BetterAuthInstance } from './better-auth.js';

export type BaOrg = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
};

/** Create a better-auth organization row (test fixture). */
export async function createBaOrg(
  auth: BetterAuthInstance,
  input: { name: string; id?: string; slug?: string },
): Promise<BaOrg> {
  const adapter = (await auth.$context).adapter;
  const id = input.id ?? randomUUID();
  const derivedSlug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = input.slug ?? (derivedSlug.length > 0 ? derivedSlug : `org-${id.slice(0, 8)}`);
  const data = {
    id,
    name: input.name,
    slug,
    createdAt: new Date(),
  };
  return adapter.create<BaOrg>({
    model: 'organization',
    data,
    forceAllowId: true,
  });
}

export async function listBaOrgs(auth: BetterAuthInstance): Promise<BaOrg[]> {
  const adapter = (await auth.$context).adapter;
  return adapter.findMany<BaOrg>({ model: 'organization' });
}

export async function getBaOrg(
  auth: BetterAuthInstance,
  id: string,
): Promise<BaOrg | undefined> {
  const adapter = (await auth.$context).adapter;
  const org = await adapter.findOne<BaOrg>({
    model: 'organization',
    where: [{ field: 'id', value: id }],
  });
  return org ?? undefined;
}
