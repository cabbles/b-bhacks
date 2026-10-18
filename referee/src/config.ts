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

function defaultModels() {
    if (env.MODEL_PROVIDER === 'gemini' || (!env.MODEL_PROVIDER && env.GEMINI_API_KEY)) return { a: 'gemini-3.8-flash', b: 'gemini-3.5-flash-lite' };
    if (env.MODEL_API_KEY) return { a: 'claude-opus-5-5', b: 'claude-sonnet-5-5' };
    return { a: 'opus', b: 'sonnet' };
}

export const config = {
    port: Number(env.PORT ?? 8787),
    dbPath: env.REFEREE_DB ?? resolve(here, '../referee.db'),
    // Serve every route from shared/fixtures instead of the real engine.
    fixtures: env.REFEREE_FIXTURES === '1',

    rpcUrl: env.RPC_URL ?? '',
    chainId: Number(dep.chainId || env.CHAIN_ID || 84532),
    pool: (env.POOL_ADDRESS || dep.pool || '') as `0x${string}` | '',
    token: (env.TOKEN_ADDRESS || dep.token || '') as `0x${string}` | '',
    refereeAddress: (dep.referee || '') as `0x${string}` | '',
    refereeKey: (env.REFEREE_PRIVATE_KEY ?? '') as `0x${string}` | '',

    // gemini: Gemini API with GEMINI_API_KEY (free tier works). api: Anthropic API with MODEL_API_KEY.
    // claude-cli: shell out to `claude -p` on a logged-in Claude subscription. off: deterministic checks only.
    modelProvider: (env.MODEL_PROVIDER ||
        (env.GEMINI_API_KEY ? 'gemini' : env.MODEL_API_KEY ? 'api' : 'claude-cli')) as 'gemini' | 'claude-cli' | 'api' | 'off',
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    modelApiKey: env.MODEL_API_KEY ?? '',
    geminiApiKey: env.GEMINI_API_KEY ?? '',
    // Two different models, so the substance check gets two independent votes.
    modelA: env.MODEL_NAME_A || defaultModels().a,
    modelB: env.MODEL_NAME_B || defaultModels().b,

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
