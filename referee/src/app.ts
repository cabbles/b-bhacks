// The referee's HTTP app and scheduled work, shared by both runtimes (node.ts locally, cf.ts on Workers).
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { chainReady, config, signerReady } from './config.ts';
import { ensureSchema, withLease } from './db.ts';
import { keeperAddress, keeperReady, keeperTick } from './keeper.ts';
import { poolReferee, signerAddress } from './chain.ts';
import { modelsReady } from './model.ts';
import { routes } from './routes.ts';
import { tick } from './worker.ts';
import { x402Routes } from './x402.ts';

export function createApp() {
    const app = new Hono();
    app.use(
        '*',
        cors({
            // The paid x402 API is public by design; everything else answers only the site's own origins.
            origin: (origin, c) => {
                if (new URL(c.req.url).pathname.startsWith('/x402')) return '*';
                if (!config.corsOrigins.length) return origin;
                return config.corsOrigins.includes(origin) ? origin : null;
            },
            exposeHeaders: ['X-PAYMENT-RESPONSE'],
        }),
    );
    app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'request body too large' }, 413) }));
    app.use('*', async (_c, next) => {
        await ensureSchema();
        await next();
    });
    app.onError((err, c) => {
        // Log the detail, return none of it: errors can carry RPC URLs or upstream responses.
        console.error(`[http] ${c.req.method} ${new URL(c.req.url).pathname}: ${err.message}`);
        return c.json({ error: 'internal error' }, 500);
    });
    app.get('/health', async (c) => {
        // Public addresses only. signer_matches_pool is false if the key is not the referee the contract accepts.
        const signer = signerAddress();
        const expected = await poolReferee().catch(() => null);
        return c.json({
            ok: true,
            chain: chainReady(),
            signer: signerReady(),
            signer_address: signer,
            signer_matches_pool: Boolean(signer && expected && signer.toLowerCase() === expected.toLowerCase()),
            keeper: keeperReady(),
            keeper_address: keeperAddress(),
            models: modelsReady(),
            github: Boolean(config.githubToken),
        });
    });
    routes(app);
    x402Routes(app);
    return app;
}

/** One scheduled run: judge, then pay out. Leases stop overlapping runs from doing the same work twice. */
export async function runScheduled() {
    await ensureSchema();
    await withLease('judge', 5 * 60_000, () => tick().catch((e) => console.error('[worker] tick failed', (e as Error).message)));
    await withLease('keeper', 5 * 60_000, () => keeperTick().catch((e) => console.error('[keeper] tick failed', (e as Error).message)));
}
