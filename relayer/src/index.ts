import cors from '@fastify/cors';
import Database from 'better-sqlite3';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAddress, parseUnits, type Address, type Hex } from 'viem';
import { deployments, poolAbi, publicClient, reason, requirePool, send, tokenAbi, treasury } from './chain.ts';

const env = process.env;
const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(env.PORT ?? 8788);
const DRIP = env.DRIP_AMOUNT ?? '100';

const db = new Database(env.RELAYER_DB ?? resolve(here, '../relayer.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS drips (address TEXT PRIMARY KEY, tx_hash TEXT, ip TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS txs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, body TEXT, tx_hash TEXT, error TEXT, created_at TEXT NOT NULL);
`);
const logTx = (kind: string, body: unknown, tx: string | null, error: string | null) =>
    db.prepare('INSERT INTO txs (kind, body, tx_hash, error, created_at) VALUES (?, ?, ?, ?, ?)').run(
        kind,
        JSON.stringify(body),
        tx,
        error,
        new Date().toISOString(),
    );

// ---- token metadata (read once from chain) ----
const decimals = await publicClient.readContract({ address: deployments.token, abi: tokenAbi, functionName: 'decimals' });
const domain = await publicClient.readContract({ address: deployments.token, abi: tokenAbi, functionName: 'eip712Domain' });
const tokenDomain = { name: domain[1], version: domain[2] };

// ---- cohorts (from CohortCreated logs + current state) ----
type CohortView = {
    id: number;
    rule_hash: Hex;
    stake_deadline: number;
    goal_deadline: number;
    stake_amount: string;
    staker_count: number;
    pass_count: number;
    fail_count: number;
    settled: boolean;
};

async function listCohorts(blockNumber?: bigint): Promise<CohortView[]> {
    if (!deployments.pool) return [];
    const count = Number(
        await publicClient.readContract({ address: deployments.pool, abi: poolAbi, functionName: 'cohortCount', blockNumber }),
    );
    const out: CohortView[] = [];
    for (let id = 1; id <= count; id++) {
        const c = (await publicClient.readContract({
            address: deployments.pool,
            abi: poolAbi,
            functionName: 'cohorts',
            args: [BigInt(id)],
            blockNumber,
        })) as readonly [Hex, bigint, bigint, bigint, number, number, number, boolean, bigint];
        out.push({
            id,
            rule_hash: c[0],
            stake_deadline: Number(c[1]),
            goal_deadline: Number(c[2]),
            stake_amount: c[3].toString(),
            staker_count: Number(c[4]),
            pass_count: Number(c[5]),
            fail_count: Number(c[6]),
            settled: c[7],
        });
    }
    return out;
}

let cohortCache: { at: number; data: CohortView[] } = { at: 0, data: [] };
async function cohorts() {
    if (Date.now() - cohortCache.at > 5_000) cohortCache = { at: Date.now(), data: await listCohorts() };
    return cohortCache.data;
}

// ---- server ----
const app = Fastify({ logger: true, bodyLimit: 16 * 1024, trustProxy: true });
await app.register(cors, { origin: true });

const bad = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const isHex32 = (x: unknown): x is Hex => typeof x === 'string' && /^0x[0-9a-fA-F]{64}$/.test(x);
const isUint = (x: unknown) => (typeof x === 'string' && /^\d+$/.test(x)) || (Number.isSafeInteger(x) && (x as number) >= 0);

function admin(req: FastifyRequest, reply: FastifyReply) {
    if (!env.ADMIN_KEY || req.headers['x-admin-key'] !== env.ADMIN_KEY) {
        bad(reply, 401, 'admin key required');
        return false;
    }
    return true;
}

app.get('/health', async () => ({ ok: true, treasury: treasury.address, pool: deployments.pool }));

app.get('/config', async () => ({
    chainId: deployments.chainId,
    pool: deployments.pool,
    token: deployments.token,
    tokenDomain,
    decimals,
    cohorts: await cohorts(),
}));

// Simple per-IP limiter for /drip on top of the once-per-address rule.
const ipHits = new Map<string, number[]>();
function ipAllowed(ip: string) {
    const now = Date.now();
    const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < 60 * 60_000);
    if (hits.length >= 20) return false;
    hits.push(now);
    ipHits.set(ip, hits);
    return true;
}

app.post('/drip', async (req, reply) => {
    const { address } = (req.body ?? {}) as { address?: string };
    if (!address || !isAddress(address)) return bad(reply, 400, 'address required');
    const key = address.toLowerCase();
    const prior = db.prepare('SELECT tx_hash FROM drips WHERE address = ?').get(key) as { tx_hash: string } | undefined;
    if (prior) return reply.code(409).send({ error: 'already dripped', tx_hash: prior.tx_hash });
    if (!ipAllowed(req.ip)) return bad(reply, 429, 'too many drips from this network');
    // Reserve the address before sending so concurrent requests cannot double-drip.
    try {
        db.prepare('INSERT INTO drips (address, ip, created_at) VALUES (?, ?, ?)').run(key, req.ip, new Date().toISOString());
    } catch {
        return bad(reply, 409, 'already dripped');
    }
    try {
        const { hash } = await send({
            address: deployments.token,
            abi: tokenAbi,
            functionName: 'transfer',
            args: [address as Address, parseUnits(DRIP, decimals)],
        });
        db.prepare('UPDATE drips SET tx_hash = ? WHERE address = ?').run(hash, key);
        logTx('drip', { address }, hash, null);
        return { tx_hash: hash };
    } catch (err) {
        db.prepare('DELETE FROM drips WHERE address = ?').run(key); // let them retry
        logTx('drip', { address }, null, reason(err));
        return bad(reply, 502, `drip failed: ${reason(err)}`);
    }
});

app.post('/stake', async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const a = b.authorization ?? {};
    if (!isUint(b.cohort_id)) return bad(reply, 400, 'cohort_id required');
    if (!b.staker || !isAddress(b.staker)) return bad(reply, 400, 'staker required');
    if (!isHex32(b.goal_hash)) return bad(reply, 400, 'goal_hash must be bytes32');
    if (!isUint(a.validAfter) || !isUint(a.validBefore) || !isHex32(a.nonce) || !isHex32(a.r) || !isHex32(a.s))
        return bad(reply, 400, 'authorization { validAfter, validBefore, nonce, v, r, s } required');
    const v = Number(a.v);
    if (v !== 27 && v !== 28 && v !== 0 && v !== 1) return bad(reply, 400, 'bad v');
    try {
        const { hash } = await send({
            address: requirePool(),
            abi: poolAbi,
            functionName: 'stakeWithAuthorization',
            args: [
                BigInt(b.cohort_id),
                b.staker,
                b.goal_hash,
                BigInt(a.validAfter),
                BigInt(a.validBefore),
                a.nonce,
                v < 27 ? v + 27 : v,
                a.r,
                a.s,
            ],
        });
        logTx('stake', b, hash, null);
        cohortCache.at = 0;
        return { tx_hash: hash };
    } catch (err) {
        logTx('stake', b, null, reason(err));
        return bad(reply, 400, `stake failed: ${reason(err)}`);
    }
});

app.post('/claim', async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!isUint(b.cohort_id)) return bad(reply, 400, 'cohort_id required');
    if (!b.staker || !isAddress(b.staker)) return bad(reply, 400, 'staker required');
    try {
        const { hash } = await send({
            address: requirePool(),
            abi: poolAbi,
            functionName: 'claimFor',
            args: [BigInt(b.cohort_id), b.staker],
        });
        logTx('claim', b, hash, null);
        return { tx_hash: hash };
    } catch (err) {
        logTx('claim', b, null, reason(err));
        return bad(reply, 400, `claim failed: ${reason(err)}`);
    }
});

// ---- operator routes (cohort ops, PLAN 5A step 8). None of these can move user funds. ----

app.post('/admin/cohorts', async (req, reply) => {
    if (!admin(req, reply)) return;
    const b = (req.body ?? {}) as any;
    const now = Math.floor(Date.now() / 1000);
    const stakeDeadline = Number(b.stake_deadline ?? now + 60 * Number(b.stake_minutes ?? 45));
    const goalDeadline = Number(b.goal_deadline ?? stakeDeadline + 60 * Number(b.goal_minutes ?? 0));
    const ruleHash = isHex32(b.rule_hash) ? b.rule_hash : (`0x${'0'.repeat(64)}` as Hex);
    try {
        const { hash, receipt } = await send({
            address: requirePool(),
            abi: poolAbi,
            functionName: 'createCohort',
            args: [ruleHash, BigInt(stakeDeadline), BigInt(goalDeadline), parseUnits(String(b.stake ?? '10'), decimals)],
        });
        // Public RPCs lag behind the receipt; read at the receipt's block, retrying until the node has it.
        let all: CohortView[] = [];
        for (let i = 0; i < 10; i++) {
            all = await listCohorts(receipt.blockNumber).catch(() => []);
            if (all.length) break;
            await new Promise((r) => setTimeout(r, 1000));
        }
        cohortCache = { at: Date.now(), data: all };
        return { tx_hash: hash, block: Number(receipt.blockNumber), cohort: all[all.length - 1] };
    } catch (err) {
        return bad(reply, 400, `createCohort failed: ${reason(err)}`);
    }
});

app.post('/admin/settle', async (req, reply) => {
    if (!admin(req, reply)) return;
    const b = (req.body ?? {}) as any;
    try {
        const { hash } = await send({ address: requirePool(), abi: poolAbi, functionName: 'settle', args: [BigInt(b.cohort_id)] });
        cohortCache.at = 0;
        return { tx_hash: hash };
    } catch (err) {
        return bad(reply, 400, `settle failed: ${reason(err)}`);
    }
});

// Claims every claimable stake in a cohort. Funds go to stakers only (claimFor).
app.post('/admin/claim-all', async (req, reply) => {
    if (!admin(req, reply)) return;
    return { claimed: await claimAll(BigInt((req.body as any)?.cohort_id ?? 0)) };
});

async function claimAll(cohortId: bigint) {
    const pool = requirePool();
    const logs = await publicClient.getContractEvents({
        address: pool,
        abi: poolAbi,
        eventName: 'Staked',
        args: { cohortId },
        fromBlock: BigInt(deployments.deployBlock ?? 0),
    });
    const results: { staker: string; tx_hash?: string; amount?: string; error?: string }[] = [];
    for (const l of logs as any[]) {
        const staker = l.args.staker as Address;
        const amount = (await publicClient.readContract({
            address: pool,
            abi: poolAbi,
            functionName: 'claimable',
            args: [cohortId, staker],
        })) as bigint;
        if (amount === 0n) continue;
        try {
            const { hash } = await send({ address: pool, abi: poolAbi, functionName: 'claimFor', args: [cohortId, staker] });
            results.push({ staker, tx_hash: hash, amount: amount.toString() });
        } catch (err) {
            results.push({ staker, error: reason(err) });
        }
    }
    return results;
}

// ---- keeper: settle each cohort once it can be settled, then pay every staker. KEEPER=0 disables. ----
const SETTLE_GRACE_S = 60; // give late verdicts a minute past the contract's 10-minute window
const paidOut = new Set<number>();
let keeperBusy = false;
async function keeperTick() {
    if (keeperBusy || !deployments.pool) return;
    keeperBusy = true;
    try {
        cohortCache.at = 0;
        const now = Math.floor(Date.now() / 1000);
        for (const c of await cohorts()) {
            if (paidOut.has(c.id) || now < c.goal_deadline + 600 + SETTLE_GRACE_S) continue;
            if (!c.settled) {
                const { hash } = await send({ address: deployments.pool, abi: poolAbi, functionName: 'settle', args: [BigInt(c.id)] });
                app.log.info(`keeper: settled cohort ${c.id} ${hash}`);
            }
            const claimed = await claimAll(BigInt(c.id));
            for (const r of claimed) app.log.info(`keeper: cohort ${c.id} ${r.staker} ${r.tx_hash ?? r.error}`);
            if (claimed.every((r) => r.tx_hash)) paidOut.add(c.id);
        }
    } catch (err) {
        app.log.error(`keeper: ${reason(err)}`);
    } finally {
        keeperBusy = false;
    }
}
if (env.KEEPER !== '0') setInterval(() => void keeperTick(), 30_000);

await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info(`relayer: treasury ${treasury.address}, pool ${deployments.pool}, domain ${tokenDomain.name}/${tokenDomain.version}`);
