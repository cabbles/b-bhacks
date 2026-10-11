import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { isAddress, type Abi, type Address, type Hex } from 'viem';
import { publicClient, reason, send } from './chain.ts';

// CommitmentBond: the task owner's own stake in a prediction market, separate from the YES/NO bets.
// Pass or no verdict: exactly the bond back. Fail: split among NO bettors, or burned if nobody bet NO.
const meta = JSON.parse(readFileSync(new URL('../../contracts/deployments/commitment-bond.json', import.meta.url), 'utf8'));
export const bondAddress: Address | null = (process.env.BOND_ADDRESS as Address) || meta.address || null;
export const bondAbi = JSON.parse(readFileSync(new URL('../../contracts/abi/CommitmentBond.json', import.meta.url), 'utf8')) as Abi;

const RESULT = ['pending', 'returned', 'to_no', 'burned'] as const;
const hex32 = (v: unknown): v is Hex => typeof v === 'string' && /^0x[\da-f]{64}$/i.test(v);
const uint = (v: unknown) => (typeof v === 'string' && /^\d{1,78}$/.test(v)) || (Number.isSafeInteger(v) && (v as number) >= 0);

async function readBond(cohort: bigint, owner: Address, bettor?: Address) {
    const id = (await publicClient.readContract({ address: bondAddress!, abi: bondAbi, functionName: 'marketId', args: [cohort, owner] })) as Hex;
    const [amount, result] = (await publicClient.readContract({ address: bondAddress!, abi: bondAbi, functionName: 'bonds', args: [id] })) as [bigint, number];
    const claimable = bettor
        ? ((await publicClient.readContract({ address: bondAddress!, abi: bondAbi, functionName: 'claimable', args: [cohort, owner, bettor] })) as bigint)
        : 0n;
    return { amount, result: RESULT[result] ?? 'pending', claimable };
}

export async function registerBonds(app: FastifyInstance) {
    app.get('/bonds/:cohort/:owner', async (req, reply) => {
        if (!bondAddress) return reply.code(503).send({ error: 'Commitment bonds are not deployed' });
        const { cohort, owner } = req.params as { cohort: string; owner: string };
        const { bettor } = req.query as { bettor?: string };
        if (!/^\d+$/.test(cohort) || !isAddress(owner) || (bettor && !isAddress(bettor))) return reply.code(400).send({ error: 'Invalid market' });
        try {
            const b = await readBond(BigInt(cohort), owner as Address, bettor as Address | undefined);
            return { address: bondAddress, amount: b.amount.toString(), result: b.result, claimable: b.claimable.toString() };
        } catch (err) {
            return reply.code(500).send({ error: reason(err) });
        }
    });

    // Owner's signed ERC-3009 ReceiveWithAuthorization to the bond contract, nonce = bondNonce(cohort, owner, amount).
    app.post('/bond', async (req, reply) => {
        if (!bondAddress) return reply.code(503).send({ error: 'Commitment bonds are not deployed' });
        const b = (req.body ?? {}) as any;
        const a = b.authorization ?? {};
        if (!uint(b.cohort_id) || !isAddress(b.owner ?? '') || !uint(b.amount)) return reply.code(400).send({ error: 'cohort_id, owner, amount required' });
        if (!uint(a.validAfter) || !uint(a.validBefore) || !hex32(a.nonce) || !hex32(a.r) || !hex32(a.s)) return reply.code(400).send({ error: 'authorization required' });
        const v = Number(a.v);
        try {
            const { hash } = await send({
                address: bondAddress,
                abi: bondAbi,
                functionName: 'bondWithAuthorization',
                args: [BigInt(b.cohort_id), b.owner, BigInt(b.amount), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, v < 27 ? v + 27 : v, a.r, a.s],
            });
            return { tx_hash: hash };
        } catch (err) {
            return reply.code(400).send({ error: `bond failed: ${reason(err)}` });
        }
    });

    // A NO bettor's share of a failed owner's bond. Funds always go to the bettor.
    app.post('/bond/claim', async (req, reply) => {
        if (!bondAddress) return reply.code(503).send({ error: 'Commitment bonds are not deployed' });
        const b = (req.body ?? {}) as any;
        if (!uint(b.cohort_id) || !isAddress(b.owner ?? '') || !isAddress(b.bettor ?? '')) return reply.code(400).send({ error: 'cohort_id, owner, bettor required' });
        try {
            const { hash } = await send({ address: bondAddress, abi: bondAbi, functionName: 'claimFor', args: [BigInt(b.cohort_id), b.owner, b.bettor] });
            return { tx_hash: hash };
        } catch (err) {
            return reply.code(400).send({ error: `claim failed: ${reason(err)}` });
        }
    });
}

/** Keeper hook: once a round is settled, resolve each staker's bond (returns or burns in the same tx). */
export async function resolveBonds(cohortId: bigint, owners: Iterable<Address>) {
    if (!bondAddress) return [];
    const out: string[] = [];
    for (const owner of owners) {
        try {
            const b = await readBond(cohortId, owner);
            if (b.amount === 0n || b.result !== 'pending') continue;
            const { hash } = await send({ address: bondAddress, abi: bondAbi, functionName: 'resolve', args: [cohortId, owner] });
            out.push(`${owner} ${hash}`);
        } catch (err) {
            out.push(`${owner} ${reason(err)}`);
        }
    }
    return out;
}
