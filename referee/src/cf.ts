// Cloudflare Workers entry point: the D1 binding for storage and a cron trigger (wrangler.jsonc) for scheduled work.
// Secrets and vars reach config.ts through process.env (nodejs_compat).
import type { D1Database, ExecutionContext } from '@cloudflare/workers-types';
import { createApp, runScheduled } from './app.ts';
import { setDb } from './db.ts';
import { d1Db } from './db-d1.ts';

type Env = { DB: D1Database };

const app = createApp();
let bound = false;
function bind(env: Env) {
    if (bound) return;
    setDb(d1Db(env.DB));
    bound = true;
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        bind(env);
        return app.fetch(request, env, ctx as any);
    },
    scheduled(_event: unknown, env: Env, ctx: ExecutionContext) {
        bind(env);
        ctx.waitUntil(runScheduled());
    },
};
