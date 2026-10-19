import type { Context, Hono } from 'hono';
import type { Hex } from 'viem';
import { config } from './config.ts';
import { db, getGoal, nowIso, rateAllowed, type GoalRow } from './db.ts';
import { getCohort, verifyStake } from './chain.ts';
import { CompileError, compileGoal } from './compile.ts';
import { override, takeSnapshot } from './engine.ts';
import { decideAndPost, postIfReady } from './worker.ts';
import { canPush } from './github-auth.ts';
import { hashJson, type Criteria } from './types.ts';

const bad = (c: Context, code: number, error: string) => c.json({ error }, code as any);
const body = (c: Context) => c.req.json().catch(() => ({})) as Promise<any>;

// Compile spends model quota (the free Gemini tier is small), so cap it. Keyed by staker, not IP: many users can
// share one IP. Counted in the database so the cap holds across Worker instances.
const COMPILE_PER_STAKER_PER_HOUR = Number(process.env.COMPILE_PER_STAKER_PER_HOUR ?? 15);
const COMPILE_TOTAL_PER_HOUR = Number(process.env.COMPILE_TOTAL_PER_HOUR ?? 400);
async function compileAllowed(staker: string): Promise<string | null> {
    if (!(await rateAllowed(`compile:${staker}`, COMPILE_PER_STAKER_PER_HOUR, 3_600_000)))
        return 'Too many goal checks from this wallet. Try again in a few minutes.';
    if (!(await rateAllowed('compile:*', COMPILE_TOTAL_PER_HOUR, 3_600_000))) return 'The referee is busy. Try again in a few minutes.';
    return null;
}

/** Constant-time comparison: hash both sides so length and content leak nothing through timing. */
async function safeEqual(a: string, b: string): Promise<boolean> {
    const enc = new TextEncoder();
    const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
    const xa = new Uint8Array(x);
    const ya = new Uint8Array(y);
    let diff = 0;
    for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
    return diff === 0;
}

async function isAdmin(c: Context) {
    const key = c.req.header('x-admin-key') ?? (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    return Boolean(config.adminKey) && key.length > 0 && (await safeEqual(key, config.adminKey));
}

function validCriteria(c: any): c is Criteria {
    return (
        c && c.version === 1 &&
        ['github_commits', 'url_live', 'canvas_submission'].includes(c.type) &&
        /^0x[0-9a-fA-F]{40}$/.test(c.staker) &&
        typeof c.goal_text === 'string' &&
        typeof c.nonce === 'string' && /^ref-[0-9a-f]{8}$/.test(c.nonce) &&
        !Number.isNaN(Date.parse(c.window?.start)) && !Number.isNaN(Date.parse(c.window?.deadline)) &&
        typeof c.params === 'object'
    );
}

function publicGoal(g: GoalRow) {
    return {
        goal_id: g.id,
        cohort_id: g.cohort_id,
        staker: g.staker,
        goal_hash: g.goal_hash,
        status: g.status,
        criteria: JSON.parse(g.criteria_json),
        verdict: g.verdict_json ? JSON.parse(g.verdict_json) : undefined,
        evidence_hash: g.evidence_hash ?? undefined,
        verdict_tx_hash: g.verdict_tx_hash ?? undefined,
        stake_tx_hash: g.stake_tx_hash,
        human_override: Boolean(g.human_override),
        created_at: g.created_at,
    };
}

export function routes(app: Hono) {
    app.get('/health', (c) => c.json({ ok: true }));

    app.post('/goals/compile', async (c) => {
        const b = await body(c);
        if (typeof b.staker !== 'string') return bad(c, 400, 'staker must be an address');
        const limited = await compileAllowed(b.staker.toLowerCase());
        if (limited) return bad(c, 429, limited);
        try {
            return c.json(await compileGoal({ text: b.text, staker: b.staker, type_hint: b.type_hint, cohort_id: b.cohort_id, deadline: b.deadline }));
        } catch (err) {
            if (err instanceof CompileError) return bad(c, 400, err.message);
            throw err;
        }
    });

    app.post('/goals', async (c) => {
        const b = await body(c);
        const cohortId = Number(b.cohort_id);
        if (!Number.isInteger(cohortId) || cohortId < 0) return bad(c, 400, 'cohort_id required');
        if (!validCriteria(b.criteria)) return bad(c, 400, 'criteria does not match the schema');
        if (!/^0x[0-9a-fA-F]{64}$/.test(b.stake_tx_hash ?? '')) return bad(c, 400, 'stake_tx_hash required');
        const criteria = b.criteria as Criteria;
        const goalHash = hashJson(criteria);

        const existing = await db().get<GoalRow>('SELECT * FROM goals WHERE cohort_id = ? AND lower(staker) = lower(?)', cohortId, criteria.staker);
        if (existing) {
            if (existing.goal_hash === goalHash) return c.json({ goal_id: existing.id });
            return bad(c, 409, 'staker already has a goal in this cohort');
        }
        const count = (await db().get<{ n: number }>('SELECT COUNT(*) AS n FROM goals WHERE cohort_id = ?', cohortId))?.n ?? 0;
        if (count >= config.maxGoalsPerCohort) return bad(c, 429, 'cohort is full');

        const cohort = await getCohort(cohortId).catch(() => null);
        if (!config.skipStakeCheck) {
            const err = await verifyStake(b.stake_tx_hash as Hex, cohortId, criteria.staker, goalHash);
            if (err) return bad(c, 400, err);
            if (!cohort) return bad(c, 400, 'unknown cohort');
            if (Date.parse(criteria.window.deadline) > cohort.goal_deadline * 1000)
                return bad(c, 400, 'criteria deadline is after the cohort goal deadline');
        }
        if (criteria.type === 'canvas_submission' && !config.canvasAllowed.includes(criteria.staker.toLowerCase()))
            return bad(c, 400, 'Canvas goals are limited to the team demo account');
        if (criteria.type === 'url_live' && !config.urlTasks) return bad(c, 400, 'Page tasks are turned off for now');
        if (criteria.type === 'github_commits') {
            // Checked again here, not only at compile: the criteria come from the client and could be edited.
            const p = criteria.params as { repo: string; github_login?: string };
            const access = await canPush(criteria.staker, p.repo);
            if (!access.ok) return bad(c, 400, access.reason);
            if (p.github_login?.toLowerCase() !== access.login.toLowerCase())
                return bad(c, 400, 'criteria name a different GitHub account than the one connected to this wallet');
        }

        const info = await db().run(
            `INSERT INTO goals (cohort_id, staker, goal_hash, type, criteria_json, stake_tx_hash, cohort_goal_deadline, created_at)
                VALUES (?,?,?,?,?,?,?,?)`,
            cohortId, criteria.staker, goalHash, criteria.type, JSON.stringify(criteria), b.stake_tx_hash,
            cohort?.goal_deadline ?? null, nowIso(),
        );
        const goalId = info.lastId;
        try {
            await takeSnapshot(goalId);
        } catch (err) {
            console.error(`[routes] goal ${goalId}: snapshot failed: ${(err as Error).message}`);
            await db().run('UPDATE goals SET last_error = ? WHERE id = ?', `snapshot: ${(err as Error).message}`, goalId);
        }
        return c.json({ goal_id: goalId });
    });

    app.get('/goals/:id', async (c) => {
        const g = await getGoal(Number(c.req.param('id')));
        if (!g) return bad(c, 404, 'not found');
        return c.json(publicGoal(g));
    });

    app.get('/cohorts/:id', async (c) => {
        const id = Number(c.req.param('id'));
        const cohort = await getCohort(id).catch(() => null);
        const rows = await db().all<GoalRow>('SELECT * FROM goals WHERE cohort_id = ? ORDER BY id', id);
        const by = (s: string) => rows.filter((r) => r.status === s).length;
        const stakeAmount = cohort ? BigInt(cohort.stake_amount) : 0n;
        return c.json({
            cohort: cohort ?? { id },
            goals: rows.map((g) => ({
                goal_id: g.id,
                staker: g.staker,
                type: g.type,
                goal_text: JSON.parse(g.criteria_json).goal_text,
                status: g.status,
                human_override: Boolean(g.human_override),
                verdict_tx_hash: g.verdict_tx_hash ?? undefined,
            })),
            stats: {
                stakers: rows.length,
                watching: by('watching'),
                passed: by('passed'),
                failed: by('failed'),
                needs_human: by('needs_human'),
                human_overrides: rows.filter((r) => r.human_override).length,
                // Goals whose verdict is not on chain yet (still watching, deciding, or posting). Settle only at 0,
                // or once the settle time has passed and needs_human goals are knowingly left to refund.
                verdicts_pending: rows.filter((r) => !r.verdict_tx_hash).length,
                pot: (stakeAmount * BigInt(rows.length)).toString(),
            },
        });
    });

    app.post('/goals/:id/verify', async (c) => {
        if (!(await isAdmin(c))) return bad(c, 401, 'admin key required');
        const id = Number(c.req.param('id'));
        if (!(await getGoal(id))) return bad(c, 404, 'not found');
        return c.json({ verdict: await decideAndPost(id) });
    });

    // Human override for needs_human (or any unposted verdict). Counted and shown publicly.
    app.post('/goals/:id/override', async (c) => {
        if (!(await isAdmin(c))) return bad(c, 401, 'admin key required');
        const id = Number(c.req.param('id'));
        const b = await body(c);
        if (typeof b.passed !== 'boolean') return bad(c, 400, 'passed (boolean) required');
        if (!(await getGoal(id))) return bad(c, 404, 'not found');
        let verdict;
        try {
            verdict = await override(id, b.passed, String(b.note ?? ''));
        } catch (err) {
            return bad(c, 409, (err as Error).message);
        }
        const g = await getGoal(id);
        if (g) await postIfReady(g).catch((e) => console.error(`[routes] goal ${id}: post failed: ${(e as Error).message}`));
        return c.json({ verdict });
    });

    // Not in the frozen API; for the admin queue and the README numbers.
    app.get('/admin/queue', async (c) => {
        if (!(await isAdmin(c))) return bad(c, 401, 'admin key required');
        const rows = await db().all<GoalRow>("SELECT * FROM goals WHERE status = 'needs_human' OR last_error IS NOT NULL ORDER BY id");
        return c.json(rows.map((g) => ({ ...publicGoal(g), last_error: g.last_error })));
    });
}
