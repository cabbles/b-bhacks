import Fastify from 'fastify';
import cors from '@fastify/cors';
import { chainReady, config, signerReady } from './config.ts';
import { modelsReady } from './model.ts';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(cors, { origin: true, exposedHeaders: ['X-PAYMENT-RESPONSE'] });

if (config.fixtures) {
    const { fixtureRoutes } = await import('./fixtures.ts');
    await app.register(fixtureRoutes);
} else {
    const { routes } = await import('./routes.ts');
    const { startWorker } = await import('./worker.ts');
    const { startKeeper } = await import('./keeper.ts');
    await app.register(routes);
    const { x402Routes } = await import('./x402.ts');
    await app.register(x402Routes);
    startWorker();
    startKeeper();
}

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(
    { fixtures: config.fixtures, chain: chainReady(), signer: signerReady(), models: modelsReady(), github: Boolean(config.githubToken) },
    'referee up',
);
