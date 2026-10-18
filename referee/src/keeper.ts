import { createWalletClient, nonceManager, parseAbi, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, publicClient, transport } from './chain.ts';
import { config } from './config.ts';
import { db, nowIso } from './db.ts';

// The keeper settles each round once the contract allows it, then pays everyone: stakers, the task
// owner's bond, and winning bettors. Every call it makes can be made by anyone, and funds only ever go
// to the person they belong to, so the keeper key needs no trust, just a little ETH for gas.

const poolAbi = parseAbi([
    'event Staked(uint256 indexed cohortId, address indexed staker, bytes32 goalHash)',
    'function cohortCount() view returns (uint256)',
    'function cohorts(uint256) view returns (bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount, uint32 stakerCount, uint32 passCount, uint32 failCount, bool settled, uint256 forfeitPool)',
    'function claimable(uint256 cohortId, address staker) view returns (uint256)',
    'function settle(uint256 cohortId)',
    'function claimFor(uint256 cohortId, address staker)',
]);
const marketAbi = parseAbi([
    'event Bet(bytes32 indexed marketId, uint256 indexed cohortId, address indexed owner, address bettor, bool yes, uint256 amount)',
    'function marketId(uint256 cohortId, address owner) pure returns (bytes32)',
    'function markets(bytes32) view returns (uint256 yesTotal, uint256 noTotal, uint8 result)',
    'function claimable(uint256 cohortId, address owner, address bettor) view returns (uint256)',
    'function resolve(uint256 cohortId, address owner)',
    'function claimFor(uint256 cohortId, address owner, address bettor)',
]);
const bondAbi = parseAbi([
    'function marketId(uint256 cohortId, address owner) pure returns (bytes32)',
    'function bonds(bytes32) view returns (uint256 amount, uint8 result)',
    'function claimable(uint256 cohortId, address owner, address bettor) view returns (uint256)',
    'function resolve(uint256 cohortId, address owner)',
    'function claimFor(uint256 cohortId, address owner, address bettor)',
]);

const SETTLE_DELAY_S = 600; // StakePool.SETTLE_DELAY
const GRACE_S = 60; // let late verdicts land before settling
const MAX_CHUNKS_PER_TICK = 25;
const MAX_SENDS_PER_TICK = 20;

const POOL = config.pool.toLowerCase();

const keeper = config.keeperKey
    ? createWalletClient({ chain, transport, account: privateKeyToAccount(config.keeperKey as Hex, { nonceManager }) })
    : null;
export const keeperReady = () => Boolean(keeper && config.pool);
export const keeperAddress = () => keeper?.account.address ?? null;

/* ------------------------------------------------------------ event scan */

const getState = (key: string) => (db.prepare('SELECT value FROM keeper_state WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const setState = (key: string, value: string) =>
    db.prepare('INSERT INTO keeper_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

/** Record every staker and bettor from contract events. Returns true once the scan has reached the chain head. */
async function syncEvents(): Promise<boolean> {
    // Tied to the pool address, so a redeploy starts a fresh scan instead of resuming the old one.
    const key = `scanned_to:${POOL}`;
    let scannedTo = BigInt(getState(key) ?? Math.max(config.deployBlock - 1, 0));
    const head = await publicClient.getBlockNumber({ cacheTime: 0 });
    for (let i = 0; i < MAX_CHUNKS_PER_TICK && scannedTo < head; i++) {
        const fromBlock = scannedTo + 1n;
        const toBlock = fromBlock + config.logChunk - 1n < head ? fromBlock + config.logChunk - 1n : head;
        const [staked, bets] = await Promise.all([
            publicClient.getContractEvents({ address: config.pool as Address, abi: poolAbi, eventName: 'Staked', fromBlock, toBlock }),
            config.marketPool
                ? publicClient.getContractEvents({ address: config.marketPool as Address, abi: marketAbi, eventName: 'Bet', fromBlock, toBlock })
                : Promise.resolve([]),
        ]);
        db.transaction(() => {
            for (const l of staked)
                db.prepare('INSERT OR IGNORE INTO keeper_stakers (pool, cohort_id, staker) VALUES (?, ?, ?)').run(POOL, Number(l.args.cohortId), l.args.staker!.toLowerCase());
            for (const l of bets)
                db.prepare('INSERT OR IGNORE INTO keeper_bettors (pool, cohort_id, owner, bettor) VALUES (?, ?, ?, ?)').run(
                    POOL,
                    Number(l.args.cohortId),
                    l.args.owner!.toLowerCase(),
                    l.args.bettor!.toLowerCase(),
                );
            setState(key, toBlock.toString());
        })();
        scannedTo = toBlock;
    }
    return scannedTo >= head;
}

/* ------------------------------------------------------------ sends */

let sends = 0;

async function send(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<Hex> {
    if (sends >= MAX_SENDS_PER_TICK) throw new Error('send budget for this tick used up');
    sends++;
    const { request } = await publicClient.simulateContract({ account: keeper!.account, address, abi, functionName, args } as any);
    const hash = await keeper!.writeContract(request as any);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted in ${hash}`);
    console.log(`[keeper] ${functionName}(${args.join(', ')}) ${hash}`);
    return hash;
}

/* ------------------------------------------------------------ payouts */

/** Settle one round and pay everyone in it. Returns true when nothing is left to do. */
async function payOut(cohortId: number): Promise<boolean> {
    const id = BigInt(cohortId);
    const pool = config.pool as Address;
    const c = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'cohorts', args: [id] });
    if (c[4] === 0) return true; // nobody staked: nothing to settle or pay
    if (!c[7]) await send(pool, poolAbi, 'settle', [id]);

    let done = true;
    const attempt = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
        } catch (err) {
            done = false;
            console.error(`[keeper] cohort ${cohortId}: ${(err as Error).message.split('\n')[0]}`);
        }
    };

    const stakers = (db.prepare('SELECT staker FROM keeper_stakers WHERE pool = ? AND cohort_id = ?').all(POOL, cohortId) as { staker: Address }[]).map((r) => r.staker);
    // The contract counts its stakers; knowing fewer means the event scan missed some, so never call this round done.
    if (stakers.length < c[4]) {
        console.error(`[keeper] cohort ${cohortId}: contract has ${c[4]} stakers but the event scan found ${stakers.length}; check DEPLOY_BLOCK`);
        done = false;
    }
    for (const staker of stakers) {
        await attempt(async () => {
            const owed = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'claimable', args: [id, staker] });
            if (owed > 0n) await send(pool, poolAbi, 'claimFor', [id, staker]);
        });

        // Every staker is a potential market owner: resolve their YES/NO market and bond, then pay that market's bettors.
        const market = config.marketPool as Address | '';
        const bond = config.bondPool as Address | '';
        if (market) {
            await attempt(async () => {
                const mid = await publicClient.readContract({ address: market, abi: marketAbi, functionName: 'marketId', args: [id, staker] });
                const m = await publicClient.readContract({ address: market, abi: marketAbi, functionName: 'markets', args: [mid] });
                if (m[2] === 0 && m[0] + m[1] > 0n) await send(market, marketAbi, 'resolve', [id, staker]);
            });
        }
        if (bond) {
            await attempt(async () => {
                const bid = await publicClient.readContract({ address: bond, abi: bondAbi, functionName: 'marketId', args: [id, staker] });
                const b = await publicClient.readContract({ address: bond, abi: bondAbi, functionName: 'bonds', args: [bid] });
                if (b[0] > 0n && b[1] === 0) await send(bond, bondAbi, 'resolve', [id, staker]);
            });
        }
        const bettors = (
            db.prepare('SELECT bettor FROM keeper_bettors WHERE pool = ? AND cohort_id = ? AND owner = ?').all(POOL, cohortId, staker) as { bettor: Address }[]
        ).map((r) => r.bettor);
        for (const bettor of bettors) {
            if (market)
                await attempt(async () => {
                    const owed = await publicClient.readContract({ address: market, abi: marketAbi, functionName: 'claimable', args: [id, staker, bettor] });
                    if (owed > 0n) await send(market, marketAbi, 'claimFor', [id, staker, bettor]);
                });
            if (bond)
                await attempt(async () => {
                    const owed = await publicClient.readContract({ address: bond, abi: bondAbi, functionName: 'claimable', args: [id, staker, bettor] });
                    if (owed > 0n) await send(bond, bondAbi, 'claimFor', [id, staker, bettor]);
                });
        }
    }
    return done;
}

export async function keeperTick(): Promise<void> {
    if (!keeperReady()) return;
    sends = 0;
    // Pay out only with a complete list of stakers and bettors.
    if (!(await syncEvents())) return;
    const count = Number(await publicClient.readContract({ address: config.pool as Address, abi: poolAbi, functionName: 'cohortCount' }));
    const done = new Set((db.prepare('SELECT cohort_id FROM keeper_done WHERE pool = ?').all(POOL) as { cohort_id: number }[]).map((r) => r.cohort_id));
    // The contract checks block time, so the keeper does too.
    const now = Number((await publicClient.getBlock({ blockTag: 'latest' })).timestamp);
    for (let cohortId = 1; cohortId <= count; cohortId++) {
        if (done.has(cohortId)) continue;
        const c = await publicClient.readContract({ address: config.pool as Address, abi: poolAbi, functionName: 'cohorts', args: [BigInt(cohortId)] });
        if (now < Number(c[2]) + SETTLE_DELAY_S + GRACE_S) continue;
        try {
            if (await payOut(cohortId)) db.prepare('INSERT OR IGNORE INTO keeper_done (pool, cohort_id, done_at) VALUES (?, ?, ?)').run(POOL, cohortId, nowIso());
        } catch (err) {
            console.error(`[keeper] cohort ${cohortId}: ${(err as Error).message.split('\n')[0]}`);
        }
        if (sends >= MAX_SENDS_PER_TICK) break; // the rest waits for the next tick
    }
}

export function startKeeper() {
    if (!keeperReady()) {
        console.log('[keeper] off (set KEEPER_PRIVATE_KEY to settle rounds and pay out automatically)');
        return;
    }
    console.log(`[keeper] on as ${keeperAddress()}`);
    let running = false;
    setInterval(async () => {
        if (running) return;
        running = true;
        try {
            await keeperTick();
        } catch (e) {
            console.error('[keeper] tick failed', (e as Error).message);
        } finally {
            running = false;
        }
    }, config.keeperMs);
}
