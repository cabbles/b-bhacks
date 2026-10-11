import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SHARED_DIR = resolve(here, '../../shared');

function readDeployments(): Record<string, any> {
    const p = resolve(SHARED_DIR, 'deployments.json');
    if (!existsSync(p)) return {};
    try {
        return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
        return {};
    }
}

const dep = readDeployments();
const env = process.env;

export const config = {
    port: Number(env.PORT ?? 8787),
    dbPath: env.REFEREE_DB ?? resolve(here, '../referee.db'),
    // Serve every route from shared/fixtures instead of the real engine.
    fixtures: env.REFEREE_FIXTURES === '1',

    rpcUrl: env.RPC_URL ?? '',
    chainId: Number(dep.chainId || env.CHAIN_ID || 84532),
    pool: (env.POOL_ADDRESS || dep.pool || '') as `0x${string}` | '',
    refereeKey: (env.REFEREE_PRIVATE_KEY ?? '') as `0x${string}` | '',

    // claude-cli: shell out to `claude -p` on the logged-in Claude subscription (default, no API bill).
    // api: Anthropic API with MODEL_API_KEY. off: deterministic checks only.
    modelProvider: (env.MODEL_PROVIDER ?? (env.MODEL_API_KEY ? 'api' : 'claude-cli')) as 'claude-cli' | 'api' | 'off',
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    modelApiKey: env.MODEL_API_KEY ?? '',
    modelA: env.MODEL_NAME_A ?? (env.MODEL_API_KEY ? 'claude-opus-5-5' : 'opus'),
    modelB: env.MODEL_NAME_B ?? (env.MODEL_API_KEY ? 'claude-sonnet-5-5' : 'sonnet'),

    githubToken: env.GITHUB_TOKEN ?? '',
    adminKey: env.ADMIN_KEY ?? '',

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
