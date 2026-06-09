/// <reference types="@cloudflare/workers-types" />

import { createSyncServer } from './app.js';
import { createD1Db } from './db/d1.js';

export interface Env {
  DB: D1Database;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createSyncServer({ db: createD1Db(env.DB) }).fetch(request, env, ctx);
  },
};
