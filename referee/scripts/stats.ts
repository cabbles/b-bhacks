// Numbers for the README (PLAN.md section 11): real stakers, attack attempts, human overrides.
//   pnpm stats            all cohorts
//   pnpm stats 3 4        only these cohorts (e.g. the live room cohort)
// Reads the referee database directly (read-only).
import Database from 'better-sqlite3';
import { config } from '../src/config.ts';

const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
const db = new Database(config.dbPath, { readonly: true });
const where = ids.length ? `WHERE cohort_id IN (${ids.join(',')})` : '';
const rows = db.prepare(`SELECT * FROM goals ${where}`).all() as any[];
const count = (f: (r: any) => boolean) => rows.filter(f).length;

const real = rows.filter((r) => !r.is_attack);
const attacks = rows.filter((r) => r.is_attack);
console.log(`Cohorts: ${ids.length ? ids.join(', ') : 'all'} (${[...new Set(rows.map((r) => r.cohort_id))].join(', ')})`);
console.log(`Real stakers: ${real.length} (passed ${count((r) => !r.is_attack && r.status === 'passed')}, failed ${count((r) => !r.is_attack && r.status === 'failed')}, needs human ${count((r) => !r.is_attack && r.status === 'needs_human')}, watching ${count((r) => !r.is_attack && r.status === 'watching')})`);
console.log(`Fool the Ref attempts: ${attacks.length} (caught ${count((r) => r.is_attack && r.status === 'failed')}, fooled ${count((r) => r.is_attack && r.status === 'passed')}, undecided ${count((r) => r.is_attack && !['passed', 'failed'].includes(r.status))})`);
const byCat = new Map<string, { caught: number; fooled: number }>();
for (const a of attacks) {
    const c = byCat.get(a.attack_category ?? 'other') ?? { caught: 0, fooled: 0 };
    if (a.status === 'failed') c.caught++;
    if (a.status === 'passed') c.fooled++;
    byCat.set(a.attack_category ?? 'other', c);
}
for (const [k, v] of byCat) console.log(`  ${k}: caught ${v.caught}, fooled ${v.fooled}`);
console.log(`Human overrides: ${count((r) => r.human_override)}`);
console.log(`Verdicts on chain: ${count((r) => r.verdict_tx_hash)} of ${count((r) => ['passed', 'failed'].includes(r.status))} decided`);
console.log(`Goal types: ${[...new Set(rows.map((r) => r.type))].map((t) => `${t} ${count((r) => r.type === t)}`).join(', ')}`);
