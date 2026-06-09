/// <reference types="@cloudflare/workers-types" />

import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema.js';
import type { SyncDb } from './client.js';

export function createD1Db(d1: D1Database): SyncDb {
  return drizzle(d1, { schema });
}
