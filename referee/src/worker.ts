import type { Hex } from 'viem';
import { config, signerReady } from './config.ts';
import { db, getGoal, type GoalRow } from './db.ts';
import { postVerdictOnChain, verdictPosted } from './chain.ts';
import { decide, pollGithub } from './engine.ts';

// One pass of the judging loop: poll watched repos, decide goals past their deadline, post verdicts.
// Runs from a cron (Workers) or a timer (Node). All state lives in the database, and each pass does a
// bounded amount of work so it fits a Worker invocation; anything left over waits for the next pass.
const MAX_POLLS = 5;
const MAX_DECISIONS = 2;
const MAX_POSTS = 3;

const setError = async (id: number, err: unknown) => {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[worker] goal ${id}: ${msg}`);
    await db().run('UPDATE goals SET last_error = ? WHERE id = ?', msg.slice(0, 500), id).catch(() => {});
};

export async function postIfReady(g: GoalRow) {
    if (!signerReady() || !g.verdict_json || g.verdict_tx_hash) return;
    if (g.status !== 'passed' && g.status !== 'failed') return;
    const criteria = JSON.parse(g.criteria_json);
    const chainDeadline = g.cohort_goal_deadline ?? Date.parse(criteria.window.deadline) / 1000;
    if (Date.now() / 1000 < chainDeadline + 5) return; // contract only accepts verdicts after goalDeadline
    const verdict = JSON.parse(g.verdict_json);
    if (await verdictPosted(g.cohort_id, g.staker)) {
        // On chain but the tx hash was never recorded: should not happen since the hash is saved on send.
        await db().run('UPDATE goals SET last_error = ? WHERE id = ?', 'verdict already on chain; tx hash unknown', g.id);
        return;
    }
    let tx: Hex;
    try {
        tx = await postVerdictOnChain(g.cohort_id, g.staker, verdict.passed, g.evidence_hash as Hex, (hash) =>
            db().run('UPDATE goals SET verdict_tx_hash = ? WHERE id = ?', hash, g.id),
        );
    } catch (err) {
        // Sent but reverted or unconfirmed: forget the hash unless the verdict did land, so the next pass retries.
        if (!(await verdictPosted(g.cohort_id, g.staker).catch(() => null)))
            await db().run('UPDATE goals SET verdict_tx_hash = NULL WHERE id = ?', g.id);
        throw err;
    }
    await db().run('UPDATE goals SET last_error = NULL WHERE id = ?', g.id);
    console.log(`[worker] goal ${g.id}: verdict ${verdict.passed ? 'PASS' : 'FAIL'} posted ${tx}`);
}

export async function tick() {
    const now = Date.now();
    const goals = await db().all<GoalRow>(
        "SELECT * FROM goals WHERE status = 'watching' OR (verdict_tx_hash IS NULL AND status IN ('passed','failed')) ORDER BY id",
    );
    const jobs: Promise<void>[] = [];
    let polls = 0;
    let decisions = 0;
    let posts = 0;
    for (const g of goals) {
        const c = JSON.parse(g.criteria_json);
        const deadline = Date.parse(c.window.deadline);
        if (g.status === 'watching') {
            if (now < deadline + config.decideGraceMs) {
                if (c.type === 'github_commits' && now - (g.last_polled_at ?? 0) >= config.githubPollMs && polls < MAX_POLLS) {
                    polls++;
                    await db().run('UPDATE goals SET last_polled_at = ? WHERE id = ?', now, g.id);
                    jobs.push(pollGithub(g).catch((e) => setError(g.id, e)));
                }
            } else if (decisions < MAX_DECISIONS) {
                decisions++;
                jobs.push(
                    decide(g.id)
                        .then((v) => console.log(`[worker] goal ${g.id}: decided ${v.passed ? 'pass' : 'fail'}`))
                        .catch((e) => setError(g.id, e)),
                );
            }
        } else if (posts < MAX_POSTS) {
            posts++;
            jobs.push(postIfReady(g).catch((e) => setError(g.id, e)));
        }
    }
    await Promise.allSettled(jobs);
}

/** Admin "verify now": decide, then post if the deadline allows. */
export async function decideAndPost(goalId: number) {
    const verdict = await decide(goalId);
    const g = await getGoal(goalId);
    if (g) await postIfReady(g).catch((e) => setError(goalId, e));
    return verdict;
}
