// Live-cohort admin: list goals needing a human or erroring, and resolve them.
//   pnpm admin                      list needs_human and errored goals
//   pnpm admin show <id>            full goal with verdict
//   pnpm admin pass <id> [note]     human override: pass
//   pnpm admin fail <id> [note]     human override: fail
//   pnpm admin verify <id>          decide now (idempotent)
// Uses REFEREE_URL (default http://localhost:8787) and ADMIN_KEY from referee/.env.
import 'dotenv/config';

const base = (process.env.REFEREE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, '');
const headers = { 'x-admin-key': process.env.ADMIN_KEY ?? '', 'content-type': 'application/json' };
const [cmd = 'queue', id, ...rest] = process.argv.slice(2);

async function call(method: string, path: string, body?: unknown) {
    const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
    return j;
}

function line(g: any) {
    const v = g.verdict;
    console.log(`#${g.goal_id} [${g.status}] ${g.staker.slice(0, 8)} ${g.criteria.type} "${g.criteria.goal_text.slice(0, 70)}"`);
    for (const c of v?.checks ?? []) console.log(`    ${c.passed ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail.slice(0, 160)}`);
    if (v?.model_votes?.length) console.log(`    votes: ${v.model_votes.map((m: any) => `${m.model}=${m.passed ? 'pass' : 'fail'}`).join(' ')}`);
    if (g.last_error) console.log(`    error: ${g.last_error}`);
}

if (cmd === 'queue') {
    const rows = await call('GET', '/admin/queue');
    if (!rows.length) console.log('Queue empty.');
    rows.forEach(line);
} else if (cmd === 'show') {
    console.log(JSON.stringify(await call('GET', `/goals/${id}`), null, 2));
} else if (cmd === 'pass' || cmd === 'fail') {
    const { verdict } = await call('POST', `/goals/${id}/override`, { passed: cmd === 'pass', note: rest.join(' ') });
    console.log(`#${id} overridden to ${verdict.passed ? 'PASS' : 'FAIL'} (human_override=${verdict.human_override}). It posts on chain after the goal deadline.`);
} else if (cmd === 'verify') {
    const { verdict } = await call('POST', `/goals/${id}/verify`);
    console.log(`#${id} ${verdict.passed ? 'PASS' : 'FAIL'}: ${verdict.reasons}`);
} else {
    console.log('usage: pnpm admin [queue | show <id> | pass <id> [note] | fail <id> [note] | verify <id>]');
}
