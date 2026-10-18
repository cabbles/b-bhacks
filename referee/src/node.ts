// Local entry point (Node): .env, a SQLite file, an HTTP server, and timers in place of the Workers cron.
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { chainReady, config, signerReady } from './config.ts';
import { setDb } from './db.ts';
import { sqliteDb } from './db-sqlite.ts';
import { keeperAddress, keeperReady } from './keeper.ts';
import { modelsReady } from './model.ts';

setDb(sqliteDb(config.dbPath));

let app: Hono;
if (config.fixtures) {
    const { fixtureRoutes } = await import('./fixtures.ts');
    app = new Hono();
    app.use('*', cors());
    fixtureRoutes(app);
} else {
    const { createApp, runScheduled } = await import('./app.ts');
    app = createApp();
    let running = false;
    setInterval(async () => {
        if (running) return;
        running = true;
        try {
            await runScheduled();
        } finally {
            running = false;
        }
    }, Math.min(config.tickMs, config.keeperMs));
}

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' });
console.log(
    `[referee] listening on :${config.port}`,
    JSON.stringify({
        fixtures: config.fixtures,
        chain: chainReady(),
        signer: signerReady(),
        models: modelsReady(),
        keeper: keeperReady() ? keeperAddress() : false,
        github: Boolean(config.githubToken),
    }),
);
