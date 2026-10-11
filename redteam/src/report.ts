// Builds redteam/results.md from results/onchain.json and results/referee.json.
//   pnpm --filter redteam report
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => {
    const p = resolve(here, '../results', f);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const onchain = read('onchain.json');
const referee = read('referee.json');
const dep = JSON.parse(readFileSync(resolve(here, '../../shared/deployments.json'), 'utf8'));
const tx = (h: string | null) => (h ? `[tx](https://sepolia.basescan.org/tx/${h})` : '');
const esc = (s: string) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160);

function tally(rows: any[]) {
    const by = new Map<string, { caught: number; fooled: number; other: number }>();
    for (const r of rows) {
        const t = by.get(r.category) ?? { caught: 0, fooled: 0, other: 0 };
        if (r.outcome === 'caught') t.caught++;
        else if (r.outcome === 'fooled') t.fooled++;
        else t.other++;
        by.set(r.category, t);
    }
    return by;
}

const lines: string[] = [];
lines.push('# Red team results', '');
lines.push(
    'Scripted cheats run against the live system on Base Sepolia: real stakes, the real referee, and the real StakePool',
    `(\`${dep.pool}\`). "Caught" means the cheat failed. "Fooled" means it got paid. Every result is reported, including the ones that worked.`,
    '',
);

const attacks = [...(referee?.results ?? []).filter((r: any) => r.is_attack), ...(onchain?.results ?? [])].filter((r: any) => r.outcome !== 'skipped');
const caught = attacks.filter((r: any) => r.outcome === 'caught').length;
const fooled = attacks.filter((r: any) => r.outcome === 'fooled').length;
lines.push(`**${caught} caught, ${fooled} fooled** out of ${attacks.length} attempts.`, '');

lines.push('## Summary by category', '', '| Category | Caught | Fooled | Other |', '|---|---|---|---|');
for (const [cat, t] of tally(attacks)) lines.push(`| ${cat} | ${t.caught} | ${t.fooled} | ${t.other} |`);
lines.push('');

if (referee) {
    lines.push(`## Referee attacks (cohort ${referee.cohort_id}, ${referee.ran_at})`, '', '| Category | Attempt | Outcome | Why | Verdict |', '|---|---|---|---|---|');
    for (const r of referee.results) {
        lines.push(`| ${r.category} | ${esc(r.note)} | **${r.outcome}** | ${esc(r.detail)} | ${tx(r.verdict_tx_hash)} |`);
    }
    lines.push('', '`control` is an honest goal, not an attack. It checks that real work still passes.', '');
}
if (onchain) {
    lines.push(`## On-chain attacks (${onchain.ran_at})`, '', '| Category | Attempt | Outcome | Why |', '|---|---|---|---|');
    for (const r of onchain.results) lines.push(`| ${r.category} | ${esc(r.attack)} | **${r.outcome}** | ${esc(r.detail)} |`);
    lines.push('');
}
lines.push('Reproduce: `pnpm --filter redteam onchain`, `pnpm --filter redteam referee`, then `pnpm --filter redteam report`.', '');

writeFileSync(resolve(here, '../results.md'), lines.join('\n'));
console.log(lines.join('\n'));
