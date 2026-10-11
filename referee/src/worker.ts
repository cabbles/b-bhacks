import type { Hex } from 'viem';
import { config, signerReady } from './config.ts';
import { db, type GoalRow } from './db.ts';
import { findPostedVerdict, postVerdictOnChain } from './chain.ts';
import { decide, pollGithub } from './engine.ts';

const inFlight = new Set<string>();
const lastPoll = new Map<number, number>();

async function once(key: string, fn: () => Promise<void>) {
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
        await fn();
    } finally {
        inFlight.delete(key);
    }
}

const setError = (id: number, err: unknown) => {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[worker] goal ${id}: ${msg}`);
    db.prepare('UPDATE goals SET last_error = ? WHERE id = ?').run(msg.slice(0, 500), id);
};

export async function postIfReady(g: GoalRow) {
    if (!signerReady() || !g.verdict_json || g.verdict_tx_hash) return;
    if (g.status !== 'passed' && g.status !== 'failed') return;
    const criteria = JSON.parse(g.criteria_json);
    const chainDeadline = g.cohort_goal_deadline ?? Date.parse(criteria.window.deadline) / 1000;
    if (Date.now() / 1000 < chainDeadline + 5) return; // contract only accepts verdicts after goalDeadline
    const verdict = JSON.parse(g.verdict_json);
    const existing = await findPostedVerdict(g.cohort_id, g.staker);
    if (existing) {
        db.prepare('UPDATE goals SET verdict_tx_hash = ? WHERE id = ?').run(existing.tx, g.id);
        if (existing.evidenceHash.toLowerCase() !== g.evidence_hash!.toLowerCase())
            console.error(`[worker] goal ${g.id}: on-chain evidence hash differs from stored verdict`);
        return;
    }
    const tx = await postVerdictOnChain(g.cohort_id, g.staker, verdict.passed, g.evidence_hash as Hex);
    db.prepare('UPDATE goals SET verdict_tx_hash = ?, last_error = NULL WHERE id = ?').run(tx, g.id);
    console.log(`[worker] goal ${g.id}: verdict ${verdict.passed ? 'PASS' : 'FAIL'} posted ${tx}`);
}

async function tick() {
    const now = Date.now();
    const goals = db.prepare("SELECT * FROM goals WHERE status = 'watching' OR (verdict_tx_hash IS NULL AND status IN ('passed','failed'))").all() as GoalRow[];
    const jobs: Promise<void>[] = [];
    for (const g of goals) {
        const c = JSON.parse(g.criteria_json);
        const deadline = Date.parse(c.window.deadline);
        if (g.status === 'watching') {
            if (now < deadline + config.decideGraceMs) {
                if (c.type === 'github_commits' && now - (lastPoll.get(g.id) ?? 0) >= config.githubPollMs) {
                    lastPoll.set(g.id, now);
                    jobs.push(once(`poll:${g.id}`, () => pollGithub(g)).catch((e) => setError(g.id, e)));
                }
            } else {
                jobs.push(once(`decide:${g.id}`, async () => {
                    const v = await decide(g.id);
                    console.log(`[worker] goal ${g.id}: decided ${v.passed ? 'pass' : 'fail'}`);
                }).catch((e) => setError(g.id, e)));
            }
        } else {
            jobs.push(once(`post:${g.id}`, () => postIfReady(g)).catch((e) => setError(g.id, e)));
        }
    }
    void Promise.allSettled(jobs); // fire and forget; inFlight prevents duplicates
}

export function startWorker() {
    let running = false;
    setInterval(async () => {
        if (running) return;
        running = true;
        try {
            await tick();
        } catch (e) {
            console.error('[worker] tick failed', e);
        } finally {
            running = false;
        }
    }, config.tickMs);
}
