// Runs on Node (env from .env via node.ts) and on Workers (env from vars/secrets via nodejs_compat's process.env).
import deployments from '../../shared/deployments.json' with { type: 'json' };

const dep = deployments as Record<string, any>;

const env = process.env;

function defaultModels() {
    if (env.MODEL_PROVIDER === 'gemini' || (!env.MODEL_PROVIDER && env.GEMINI_API_KEY)) return { a: 'gemini-3.8-flash', b: 'gemini-3.5-flash-lite' };
    return { a: 'claude-opus-5-5', b: 'claude-sonnet-5-5' };
}

export const config = {
    port: Number(env.PORT ?? 8787),
    // Local only; on Workers the database is the D1 binding.
    dbPath: env.REFEREE_DB ?? 'referee.db',
    // Serve every route from shared/fixtures instead of the real engine.
    fixtures: env.REFEREE_FIXTURES === '1',

    rpcUrl: env.RPC_URL ?? '',
    chainId: Number(dep.chainId || env.CHAIN_ID || 84532),
    pool: (env.POOL_ADDRESS || dep.pool || '') as `0x${string}` | '',
    token: (env.TOKEN_ADDRESS || dep.token || '') as `0x${string}` | '',
    refereeAddress: (dep.referee || '') as `0x${string}` | '',
    refereeKey: (env.REFEREE_PRIVATE_KEY ?? '') as `0x${string}` | '',
    marketPool: (env.MARKET_POOL_ADDRESS || dep.market_pool || '') as `0x${string}` | '',
    bondPool: (env.BOND_ADDRESS || dep.bond_pool || '') as `0x${string}` | '',
    // Where the keeper's event scan starts. deployments.json's block only belongs to deployments.json's pool.
    deployBlock: Number(env.DEPLOY_BLOCK || (env.POOL_ADDRESS ? 0 : dep.deployBlock) || 0),
    // Pays gas for settle and payouts, which anyone may call. Kept apart from the referee key on purpose:
    // it can't post verdicts, so a leak costs only its small ETH balance. Unset = keeper off.
    keeperKey: (env.KEEPER_PRIVATE_KEY ?? '') as `0x${string}` | '',
    keeperMs: Number(env.KEEPER_MS ?? 30_000),
    // Per-run caps. Each send signs a transaction (CPU) and each log chunk is an RPC request, and a free Worker
    // run gets 10 ms of CPU and 50 outbound requests. Whatever is left waits for the next run.
    keeperMaxSends: Number(env.KEEPER_MAX_SENDS ?? 4),
    keeperMaxChunks: Number(env.KEEPER_MAX_CHUNKS ?? 10),
    // Max block range per eth_getLogs call; sepolia.base.org allows 200, keyed RPCs often more.
    logChunk: BigInt(env.LOG_CHUNK ?? 200),

    // gemini: Gemini API with GEMINI_API_KEY (free tier works). api: Anthropic API with MODEL_API_KEY.
    // off: deterministic checks only.
    modelProvider: (env.MODEL_PROVIDER || (env.GEMINI_API_KEY ? 'gemini' : env.MODEL_API_KEY ? 'api' : 'off')) as 'gemini' | 'api' | 'off',
    modelApiKey: env.MODEL_API_KEY ?? '',
    geminiApiKey: env.GEMINI_API_KEY ?? '',
    // Two different models, so the substance check gets two independent votes.
    modelA: env.MODEL_NAME_A || defaultModels().a,
    modelB: env.MODEL_NAME_B || defaultModels().b,

    githubToken: env.GITHUB_TOKEN ?? '',
    adminKey: env.ADMIN_KEY ?? '',
    // Browser origins allowed to call the referee, comma-separated (e.g. https://cashcow.vercel.app).
    // Empty allows any origin (local dev). /x402 is a public API and always allows any origin.
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),

    canvasToken: env.CANVAS_TOKEN ?? '',
    canvasBase: env.CANVAS_BASE_URL ?? 'https://bcourses.berkeley.edu',
    canvasAllowed: (env.CANVAS_ALLOWED_STAKERS ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),

    githubPollMs: Number(env.GITHUB_POLL_MS ?? 30_000),
    tickMs: Number(env.TICK_MS ?? 10_000),
    // Wait this long after the criteria deadline before deciding, so a final poll lands.
    decideGraceMs: Number(env.DECIDE_GRACE_MS ?? 45_000),
    maxGoalsPerCohort: Number(env.MAX_GOALS_PER_COHORT ?? 60),
    // Skip on-chain stake verification (local dev only).
    skipStakeCheck: env.SKIP_STAKE_CHECK === '1',
};

export const chainReady = () => Boolean(config.rpcUrl && config.pool);
export const signerReady = () => Boolean(chainReady() && config.refereeKey);
