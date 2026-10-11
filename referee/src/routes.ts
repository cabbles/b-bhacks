import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Hex } from 'viem';
import { config } from './config.ts';
import { db, getGoal, nowIso, type GoalRow } from './db.ts';
import { getCohort, verifyStake } from './chain.ts';
import { CompileError, compileGoal } from './compile.ts';
import { decide, override, takeSnapshot } from './engine.ts';
import { postIfReady } from './worker.ts';
import { hashJson, type Criteria } from './types.ts';

export const ATTACK_CATEGORIES = [
    'backdated_commits',
    'foreign_repo',
    'filler_commits',
    'prompt_injection',
    'fake_page',
    'other',
] as const;

function guessCategory(note: string): string {
    const n = note.toLowerCase();
    if (/backdat|--date|old commit|timestamp/.test(n)) return 'backdated_commits';
    if (/someone else|other.*repo|fork|not my repo/.test(n)) return 'foreign_repo';
    if (/whitespace|filler|readme|churn|empty commit/.test(n)) return 'filler_commits';
    if (/ignore|instruction|prompt|inject|mark .*pass/.test(n)) return 'prompt_injection';
    if (/static|fake|placeholder|mock/.test(n)) return 'fake_page';
    return 'other';
}

const bad = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

function isAdmin(req: FastifyRequest) {
    const key = req.headers['x-admin-key'] ?? (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return Boolean(config.adminKey) && key === config.adminKey;
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

function attackOutcome(g: GoalRow) {
    if (g.status === 'passed') return 'fooled';
    if (g.status === 'failed') return 'caught';
    return null;
}

export async function routes(app: FastifyInstance) {
    app.get('/health', async () => ({ ok: true }));

    app.post('/goals/compile', async (req, reply) => {
        const b = (req.body ?? {}) as any;
        try {
            return await compileGoal({ text: b.text, staker: b.staker, type_hint: b.type_hint, cohort_id: b.cohort_id, deadline: b.deadline });
        } catch (err) {
            if (err instanceof CompileError) return bad(reply, 400, err.message);
            throw err;
        }
    });

    app.post('/goals', async (req, reply) => {
        const b = (req.body ?? {}) as any;
        const cohortId = Number(b.cohort_id);
        if (!Number.isInteger(cohortId) || cohortId < 0) return bad(reply, 400, 'cohort_id required');
        if (!validCriteria(b.criteria)) return bad(reply, 400, 'criteria does not match the schema');
        if (!/^0x[0-9a-fA-F]{64}$/.test(b.stake_tx_hash ?? '')) return bad(reply, 400, 'stake_tx_hash required');
        const criteria = b.criteria as Criteria;
        const goalHash = hashJson(criteria);

        const existing = db.prepare('SELECT * FROM goals WHERE cohort_id = ? AND lower(staker) = lower(?)').get(cohortId, criteria.staker) as GoalRow | undefined;
        if (existing) {
            if (existing.goal_hash === goalHash) return { goal_id: existing.id };
            return bad(reply, 409, 'staker already has a goal in this cohort');
        }
        const count = (db.prepare('SELECT COUNT(*) n FROM goals WHERE cohort_id = ?').get(cohortId) as any).n;
        if (count >= config.maxGoalsPerCohort) return bad(reply, 429, 'cohort is full');

        const cohort = await getCohort(cohortId).catch(() => null);
        if (!config.skipStakeCheck) {
            const err = await verifyStake(b.stake_tx_hash as Hex, cohortId, criteria.staker, goalHash);
            if (err) return bad(reply, 400, err);
            if (!cohort) return bad(reply, 400, 'unknown cohort');
            if (Date.parse(criteria.window.deadline) > cohort.goal_deadline * 1000)
                return bad(reply, 400, 'criteria deadline is after the cohort goal deadline');
        }
        if (criteria.type === 'canvas_submission' && !config.canvasAllowed.includes(criteria.staker.toLowerCase()))
            return bad(reply, 400, 'Canvas goals are limited to the team demo account');

        const isAttack = Boolean(b.is_attack);
        const note = isAttack ? String(b.attack_note ?? '').slice(0, 500) : null;
        const category = isAttack
            ? ATTACK_CATEGORIES.includes(b.attack_category) ? b.attack_category : guessCategory(note ?? '')
            : null;
        const info = db.prepare(
            `INSERT INTO goals (cohort_id, staker, goal_hash, type, criteria_json, stake_tx_hash, cohort_goal_deadline,
                is_attack, attack_category, attack_note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(cohortId, criteria.staker, goalHash, criteria.type, JSON.stringify(criteria), b.stake_tx_hash,
            cohort?.goal_deadline ?? null, isAttack ? 1 : 0, category, note, nowIso());
        const goalId = Number(info.lastInsertRowid);
        try {
            await takeSnapshot(goalId);
        } catch (err) {
            req.log.error({ err, goalId }, 'snapshot failed');
            db.prepare('UPDATE goals SET last_error = ? WHERE id = ?').run(`snapshot: ${(err as Error).message}`, goalId);
        }
        return { goal_id: goalId };
    });

    app.get('/goals/:id', async (req, reply) => {
        const g = getGoal(Number((req.params as any).id));
        if (!g) return bad(reply, 404, 'not found');
        return publicGoal(g);
    });

    app.get('/cohorts/:id', async (req) => {
        const id = Number((req.params as any).id);
        const cohort = await getCohort(id).catch(() => null);
        const rows = db.prepare('SELECT * FROM goals WHERE cohort_id = ? ORDER BY id').all(id) as GoalRow[];
        const by = (s: string) => rows.filter((r) => r.status === s).length;
        const stakeAmount = cohort ? BigInt(cohort.stake_amount) : 0n;
        return {
            cohort: cohort ?? { id },
            goals: rows.map((g) => ({
                goal_id: g.id,
                staker: g.staker,
                type: g.type,
                goal_text: JSON.parse(g.criteria_json).goal_text,
                status: g.status,
                is_attack: Boolean(g.is_attack),
                human_override: Boolean(g.human_override),
                verdict_tx_hash: g.verdict_tx_hash ?? undefined,
            })),
            stats: {
                stakers: rows.length,
                watching: by('watching'),
                passed: by('passed'),
                failed: by('failed'),
                needs_human: by('needs_human'),
                attacks: rows.filter((r) => r.is_attack).length,
                human_overrides: rows.filter((r) => r.human_override).length,
                pot: (stakeAmount * BigInt(rows.length)).toString(),
            },
        };
    });

    app.post('/goals/:id/verify', async (req, reply) => {
        if (!isAdmin(req)) return bad(reply, 401, 'admin key required');
        const id = Number((req.params as any).id);
        if (!getGoal(id)) return bad(reply, 404, 'not found');
        const verdict = await decide(id);
        postIfReady(getGoal(id)!).catch((e) => req.log.error(e, 'post failed'));
        return { verdict };
    });

    // Human override for needs_human (or any unposted verdict). Counted and shown publicly.
    app.post('/goals/:id/override', async (req, reply) => {
        if (!isAdmin(req)) return bad(reply, 401, 'admin key required');
        const id = Number((req.params as any).id);
        const b = (req.body ?? {}) as any;
        if (typeof b.passed !== 'boolean') return bad(reply, 400, 'passed (boolean) required');
        if (!getGoal(id)) return bad(reply, 404, 'not found');
        try {
            const verdict = override(id, b.passed, String(b.note ?? ''));
            postIfReady(getGoal(id)!).catch((e) => req.log.error(e, 'post failed'));
            return { verdict };
        } catch (err) {
            return bad(reply, 409, (err as Error).message);
        }
    });

    app.get('/attacks', async () => {
        const rows = db.prepare('SELECT * FROM goals WHERE is_attack = 1 ORDER BY id DESC').all() as GoalRow[];
        return rows
            .filter((g) => attackOutcome(g))
            .map((g) => ({
                goal_id: g.id,
                category: g.attack_category ?? 'other',
                note: g.attack_note ?? '',
                outcome: attackOutcome(g),
                decided_at: g.decided_at,
            }));
    });

    // Not in the frozen API; for the admin queue and the README numbers.
    app.get('/admin/queue', async (req, reply) => {
        if (!isAdmin(req)) return bad(reply, 401, 'admin key required');
        const rows = db.prepare("SELECT * FROM goals WHERE status = 'needs_human' OR last_error IS NOT NULL ORDER BY id").all() as GoalRow[];
        return rows.map((g) => ({ ...publicGoal(g), last_error: g.last_error }));
    });
}
