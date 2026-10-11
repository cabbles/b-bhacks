import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { isAddress, keccak256, encodeAbiParameters, type Abi, type Address, type Hex } from 'viem';
import { deployments, poolAbi, publicClient, reason, send } from './chain.ts';

const metadata = JSON.parse(readFileSync(new URL('../../contracts/deployments/market-pool.json', import.meta.url), 'utf8'));
export const marketAddress: Address | null = process.env.MARKET_POOL_ADDRESS as Address || metadata.address || null;
export const marketAbi = JSON.parse(readFileSync(new URL('../../contracts/abi/MarketPool.json', import.meta.url), 'utf8')) as Abi;
const uint = (v: unknown) => typeof v === 'string' && /^\d{1,78}$/.test(v) && BigInt(v) < 2n ** 256n;
const hex32 = (v: unknown) => typeof v === 'string' && /^0x[\da-f]{64}$/i.test(v);
const cohortNumber = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
const idOf = (id: bigint, owner: Address) => keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [id, owner]));

export async function registerMarkets(app: FastifyInstance) {
    if (marketAddress) {
        if (!isAddress(marketAddress) || marketAddress === '0x0000000000000000000000000000000000000000') throw new Error('Invalid MARKET_POOL_ADDRESS');
        const linked = await publicClient.readContract({ address: marketAddress, abi: marketAbi, functionName: 'stakePool' }) as string;
        if (linked.toLowerCase() !== deployments.pool?.toLowerCase()) throw new Error('MarketPool links to a different StakePool');
    }
    const hits = new Map<string, number[]>();
    app.get('/markets/:cohort/:owner', async (req, reply) => {
        if (!marketAddress) return reply.code(503).send({ error: 'YES/NO betting is not deployed yet' });
        const { cohort, owner } = req.params as { cohort: string; owner: Address };
        const { bettor } = req.query as { bettor?: Address };
        if (!cohortNumber(cohort) || !isAddress(owner) || (bettor && !isAddress(bettor))) return reply.code(400).send({ error: 'Invalid market or bettor' });
        try {
            const id = BigInt(cohort); const key = idOf(id, owner);
            // One block keeps totals, verdict, balances and nonce internally consistent.
            const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });
            const read = (functionName: string, args: readonly unknown[]) => publicClient.readContract({ address: marketAddress, abi: marketAbi, functionName, args, blockNumber });
            const [m, c, st, p, claimable, sequence] = await Promise.all([
                read('markets', [key]),
                publicClient.readContract({ address: deployments.pool!, abi: poolAbi, functionName: 'cohorts', args: [id], blockNumber }),
                publicClient.readContract({ address: deployments.pool!, abi: poolAbi, functionName: 'stakes', args: [id, owner], blockNumber }),
                bettor ? read('positions', [key, bettor]) : [0n, 0n, false],
                bettor ? read('claimable', [id, owner, bettor]) : 0n,
                bettor ? read('sequences', [bettor]) : 0n,
            ]) as [readonly [bigint, bigint, number], readonly unknown[], readonly [Hex, number, boolean], readonly [bigint, bigint, boolean], bigint, bigint];
            if (/^0x0{64}$/.test(st[0])) return reply.code(404).send({ error: 'Task owner has no commitment in this market' });
            return { address: marketAddress, market_id: key, cohort_id: Number(id), owner,
                yes_total: m[0].toString(), no_total: m[1].toString(), result: Number(m[2]),
                betting_deadline: Number(c[1]), goal_deadline: Number(c[2]), settled: Boolean(c[7]), outcome: Number(st[1]),
                yes_amount: p[0].toString(), no_amount: p[1].toString(), claimed: p[2], claimable: claimable.toString(), sequence: sequence.toString() };
        } catch (err) { return reply.code(502).send({ error: `Market read failed: ${reason(err)}` }); }
    });
    for (const action of ['bet', 'resolve', 'claim'] as const) {
        app.post(`/markets/${action}`, async (req, reply) => {
            if (!marketAddress) return reply.code(503).send({ error: 'YES/NO betting is not deployed yet' });
            const b = (req.body ?? {}) as any;
            if (!cohortNumber(b.cohort_id) || !isAddress(b.owner ?? '')) return reply.code(400).send({ error: 'Valid cohort_id and owner required' });
            if (action !== 'resolve' && !isAddress(b.bettor ?? '')) return reply.code(400).send({ error: 'Valid bettor required' });
            const args: unknown[] = [BigInt(b.cohort_id), b.owner];
            if (action === 'bet') {
                const a = b.authorization ?? {};
                if (typeof b.yes !== 'boolean' || !uint(b.amount) || BigInt(b.amount) === 0n ||
                    !uint(a.validAfter) || !uint(a.validBefore) || !hex32(a.nonce) || !hex32(a.r) || !hex32(a.s) || ![27, 28].includes(a.v))
                    return reply.code(400).send({ error: 'Valid side, raw token amount and ERC-3009 authorization required' });
                args.push(b.bettor, b.yes, BigInt(b.amount), { ...a, validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) });
            } else if (action === 'claim') args.push(b.bettor);
            const recent = (hits.get(req.ip) ?? []).filter((t) => Date.now() - t < 60_000);
            if (recent.length >= 60) return reply.code(429).send({ error: 'Too many market requests; try again in a minute' });
            hits.set(req.ip, [...recent, Date.now()]);
            try {
                const { hash } = await send({ address: marketAddress, abi: marketAbi,
                    functionName: action === 'bet' ? 'betWithAuthorization' : action === 'claim' ? 'claimFor' : 'resolve', args });
                return { tx_hash: hash };
            } catch (err) { return reply.code(400).send({ error: `Market ${action} failed: ${reason(err)}` }); }
        });
    }
}
