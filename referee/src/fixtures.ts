import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';

const SHARED_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../shared');

// REFEREE_FIXTURES=1 (local Node only): serve every route from shared/fixtures, for rehearsals and web work.

function load(): Record<string, any> {
    const dir = resolve(SHARED_DIR, 'fixtures');
    const out: Record<string, any> = {};
    if (!existsSync(dir)) return out;
    const walk = (d: string) => {
        for (const f of readdirSync(d, { withFileTypes: true })) {
            const p = resolve(d, f.name);
            if (f.isDirectory()) walk(p);
            else if (f.name.endsWith('.json')) {
                try {
                    out[p.slice(dir.length + 1).replace(/\.json$/, '')] = JSON.parse(readFileSync(p, 'utf8'));
                } catch {}
            }
        }
    };
    walk(dir);
    return out;
}

const pick = (fx: Record<string, any>, ...words: string[]) =>
    Object.entries(fx).find(([k]) => words.every((w) => k.toLowerCase().includes(w)))?.[1];

export function fixtureRoutes(app: Hono) {
    const fx = load();
    const criteria = pick(fx, 'criteria', 'github') ?? pick(fx, 'criteria') ?? {
        version: 1, type: 'github_commits', staker: '0x0000000000000000000000000000000000000001',
        goal_text: 'Ship the login page to my repo', window: { start: '2026-10-11T20:00:00Z', deadline: '2026-10-11T23:00:00Z' },
        nonce: 'ref-1a2b3c4d', params: { repo: 'octocat/hello', branch: 'main', min_commits: 2 },
    };
    const verdict = pick(fx, 'verdict', 'github') ?? pick(fx, 'verdict') ?? null;

    app.get('/health', (c) => c.json({ ok: true, fixtures: true }));
    app.post('/goals/compile', (c) =>
        c.json(pick(fx, 'compile') ?? {
            criteria,
            goal_hash: '0x' + '11'.repeat(32),
            summary: 'Push at least 2 new commits to octocat/hello (main) before the deadline.',
            control_proof: `Commit an empty file at .referee/${criteria.nonce}.`,
        }));
    app.post('/goals', (c) => c.json(pick(fx, 'goals', 'post') ?? { goal_id: 1 }));
    app.get('/goals/:id', (c) =>
        c.json(pick(fx, 'goal', 'get') ?? {
            goal_id: 1, status: verdict ? (verdict.passed ? 'passed' : 'failed') : 'watching', criteria,
            verdict: verdict ?? undefined, verdict_tx_hash: verdict ? '0x' + '22'.repeat(32) : undefined,
        }));
    app.get('/cohorts/:id', (c) =>
        c.json(pick(fx, 'cohort') ?? {
            cohort: { id: Number(c.req.param('id')), stake_deadline: 0, goal_deadline: 0, stake_amount: '10000000' },
            goals: [{ goal_id: 1, staker: criteria.staker, type: criteria.type, goal_text: criteria.goal_text, status: 'watching', human_override: false }],
            stats: { stakers: 1, watching: 1, passed: 0, failed: 0, needs_human: 0, human_overrides: 0, pot: '10000000' },
        }));
    app.post('/goals/:id/verify', (c) => c.json({ verdict }));
}
