// Regenerates shared/fixtures/ so every hash in them is real.
// Run from the repo root: pnpm exec tsx shared/scripts/gen-fixtures.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toBytes } from 'viem';
import { canonical } from '../canonical.ts';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const hash = (o: unknown) => keccak256(toBytes(canonical(o)));
const write = (name: string, data: unknown) => {
    const p = resolve(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
};

const STAKER = '0x1111111111111111111111111111111111111111';
const STAKER2 = '0x2222222222222222222222222222222222222222';
const window = { start: '2026-10-11T22:20:00Z', deadline: '2026-10-11T23:05:00Z' };
const decided = '2026-10-11T23:05:30Z';
const TX = (n: number) => '0x' + n.toString(16).padStart(2, '0').repeat(32);

const criteria = {
    github_commits: {
        version: 1,
        type: 'github_commits',
        staker: STAKER,
        goal_text: 'Ship the dark mode toggle to my portfolio repo',
        window,
        nonce: 'ref-1a2b3c4d',
        params: { repo: 'octocat/portfolio', branch: 'main', min_commits: 2 },
    },
    url_live: {
        version: 1,
        type: 'url_live',
        staker: STAKER2,
        goal_text: 'Launch my project landing page with a signup form',
        window,
        nonce: 'ref-5e6f7a8b',
        params: { url: 'https://example.dev/launch', must_contain: 'Join the waitlist' },
    },
    canvas_submission: {
        version: 1,
        type: 'canvas_submission',
        staker: STAKER,
        goal_text: 'Submit CS 61B project 2',
        window,
        nonce: 'ref-9c0d1e2f',
        params: { course_id: 1234567, assignment_id: 7654321, min_bytes: 1 },
    },
} as const;

const verdicts = {
    github_commits: {
        version: 1,
        cohort_id: 1,
        staker: STAKER,
        goal_hash: hash(criteria.github_commits),
        passed: true,
        checks: [
            { name: 'repo_control', passed: true, detail: 'nonce file found' },
            { name: 'commits_in_window', passed: true, detail: '3 of 2 commits first seen in window' },
            { name: 'substance', passed: true, detail: 'adds a theme toggle component and wires it into the header' },
        ],
        reasons: 'The referee saw 3 new commits inside the window and they add the dark mode toggle.',
        evidence: [
            { kind: 'github_commit', ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', first_seen: '2026-10-11T22:41:12Z' },
            { kind: 'github_commit', ref: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890', first_seen: '2026-10-11T22:52:40Z' },
            { kind: 'github_commit', ref: 'c3d4e5f60718293a4b5c6d7e8f90123456789012', first_seen: '2026-10-11T23:01:03Z' },
        ],
        model_votes: [
            { model: 'model-a', passed: true },
            { model: 'model-b', passed: true },
        ],
        human_override: false,
        decided_at: decided,
    },
    url_live: {
        version: 1,
        cohort_id: 1,
        staker: STAKER2,
        goal_hash: hash(criteria.url_live),
        passed: false,
        checks: [
            { name: 'not_live_at_stake', passed: true, detail: 'target text absent at stake time' },
            { name: 'url_control', passed: true, detail: 'nonce found in /.well-known/referee.txt' },
            { name: 'url_content', passed: false, detail: 'target text not found' },
        ],
        reasons: 'The page was reachable but never showed "Join the waitlist" before the deadline.',
        evidence: [{ kind: 'url_snapshot', ref: 'https://example.dev/launch#sha256=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', first_seen: '2026-10-11T23:05:20Z' }],
        model_votes: [],
        human_override: false,
        decided_at: decided,
    },
    canvas_submission: {
        version: 1,
        cohort_id: 1,
        staker: STAKER,
        goal_hash: hash(criteria.canvas_submission),
        passed: true,
        checks: [
            { name: 'canvas_submitted', passed: true, detail: 'submitted at 2026-10-11T22:58:01Z' },
            { name: 'canvas_min_bytes', passed: true, detail: '48213 bytes attached' },
        ],
        reasons: 'Canvas shows the assignment submitted inside the window with a file attached.',
        evidence: [{ kind: 'canvas_attachment', ref: '99887766', first_seen: '2026-10-11T23:05:10Z' }],
        model_votes: [],
        human_override: false,
        decided_at: decided,
    },
};

for (const t of Object.keys(criteria) as (keyof typeof criteria)[]) {
    write(`criteria.${t}.json`, criteria[t]);
    write(`verdict.${t}.json`, verdicts[t]);
}

// Hashes, so anyone can check their canonical() + keccak matches.
write('hashes.json', {
    goal_hash: Object.fromEntries(Object.entries(criteria).map(([k, v]) => [k, hash(v)])),
    evidence_hash: Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, hash(v)])),
});

// Referee API (PLAN 4.5)
const gh = criteria.github_commits;
write('api/compile.response.json', {
    criteria: gh,
    goal_hash: hash(gh),
    summary: 'Push at least 2 new commits to octocat/portfolio (main) before 23:05 UTC.',
});
write('api/goals.post.response.json', { goal_id: 1 });
write('api/goal.get.response.json', {
    status: 'passed',
    criteria: gh,
    verdict: verdicts.github_commits,
    verdict_tx_hash: TX(0x22),
});
write('api/goal.get.watching.response.json', { status: 'watching', criteria: criteria.url_live });
write('api/cohort.get.response.json', {
    cohort: { id: 1, stake_deadline: 1791763200, goal_deadline: 1791767100, stake_amount: '10000000' },
    goals: [
        { goal_id: 1, staker: STAKER, type: 'github_commits', goal_text: gh.goal_text, status: 'passed', human_override: false },
        { goal_id: 2, staker: STAKER2, type: 'url_live', goal_text: criteria.url_live.goal_text, status: 'failed', human_override: false },
        { goal_id: 3, staker: '0x3333333333333333333333333333333333333333', type: 'github_commits', goal_text: 'Finish the API (backdated)', status: 'failed', human_override: false },
        { goal_id: 4, staker: '0x4444444444444444444444444444444444444444', type: 'github_commits', goal_text: 'Write the parser', status: 'watching', human_override: false },
    ],
    stats: { stakers: 4, watching: 1, passed: 1, failed: 2, needs_human: 0, human_overrides: 0, pot: '40000000' },
});
write('api/verify.response.json', { verdict: verdicts.github_commits });
write('api/health.response.json', { ok: true });

// Relayer API (PLAN 4.6)
write('api/relayer.config.response.json', {
    chainId: 84532,
    pool: '0x0000000000000000000000000000000000000000',
    token: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
    tokenDomain: { name: 'Agora Dollar', version: '1' },
    decimals: 6,
    cohorts: [{ id: 1, rule_hash: TX(0x33), stake_deadline: 1791763200, goal_deadline: 1791767100, stake_amount: '10000000' }],
});
write('api/relayer.drip.response.json', { tx_hash: TX(0x44) });
write('api/relayer.stake.request.json', {
    cohort_id: 1,
    staker: STAKER,
    goal_hash: hash(gh),
    authorization: { validAfter: '0', validBefore: '1791767100', nonce: TX(0x55), v: 27, r: TX(0x66), s: TX(0x77) },
});
write('api/relayer.stake.response.json', { tx_hash: TX(0x88) });
write('api/relayer.claim.response.json', { tx_hash: TX(0x99) });

console.log('fixtures written to', dir);
