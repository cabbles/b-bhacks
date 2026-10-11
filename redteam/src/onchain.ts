// On-chain red team against the live StakePool. Attacks that must fail are run as eth_call
// simulations (free, no state change), using arbitrary `from` addresses — including the
// referee's — so they show what the contract itself enforces.
//   pnpm --filter redteam onchain
import { config as loadEnv } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BaseError,
    ContractFunctionRevertedError,
    createPublicClient,
    encodeAbiParameters,
    http,
    keccak256,
    parseSignature,
    toHex,
    type Abi,
    type Address,
    type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });
const shared = resolve(here, '../../shared');
const dep = JSON.parse(readFileSync(resolve(shared, 'deployments.json'), 'utf8'));
const abi = JSON.parse(readFileSync(resolve(shared, 'abi/StakePool.json'), 'utf8')) as Abi;
const RELAYER = process.env.RELAYER_URL ?? dep.relayer_url;
const pool = dep.pool as Address;
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL ?? 'https://sepolia.base.org') });

type Result = { category: string; attack: string; outcome: 'caught' | 'fooled' | 'skipped'; detail: string };
const results: Result[] = [];

async function relayer(path: string, body?: unknown) {
    const res = await fetch(`${RELAYER}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json)}`);
    return json;
}

/** Simulate a call that should revert. Caught = it reverts; fooled = it would succeed. */
async function expectRevert(category: string, attack: string, account: Address, functionName: string, args: unknown[], want?: string) {
    try {
        await client.simulateContract({ address: pool, abi, functionName, args, account } as any);
        results.push({ category, attack, outcome: 'fooled', detail: `${functionName} would succeed` });
    } catch (err) {
        let name = 'reverted';
        if (err instanceof BaseError) {
            const r = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
            name = r?.data?.errorName ?? r?.signature ?? r?.shortMessage ?? err.shortMessage;
        }
        const ok = !want || name === want;
        results.push({ category, attack, outcome: 'caught', detail: `reverted: ${name}${want && !ok ? ` (expected ${want})` : ''}` });
    }
    console.log(results.at(-1));
}

const cfg = await relayer('/config');
const now = Math.floor(Date.now() / 1000);
const open = [...cfg.cohorts].reverse().find((c: any) => c.stake_deadline > now + 60);
const settled = cfg.cohorts.find((c: any) => c.settled);
const anyCohort = cfg.cohorts[0];
const stranger = privateKeyToAccount(generatePrivateKey()).address;
const treasury: Address = '0xC69A8c5B3cfF30Bf449Dac460fBaac82040208Cb';

// 1. Only the referee can rule.
for (const [who, addr] of [['treasury/operator', treasury], ['random address', stranger]] as const) {
    await expectRevert('onchain_fake_verdict', `${who} posts a passing verdict`, addr, 'postVerdict', [BigInt(anyCohort.id), stranger, true, keccak256(toHex('x'))], 'NotReferee');
}

// 2. Even the referee cannot rule before the deadline.
if (open) {
    await expectRevert('onchain_early_verdict', 'referee posts a verdict before the goal deadline', dep.referee, 'postVerdict', [BigInt(open.id), stranger, true, keccak256(toHex('x'))], 'TooEarly');
    await expectRevert('onchain_early_settle', 'anyone settles before deadline + 10 min', stranger, 'settle', [BigInt(open.id)], 'TooEarly');
}

// 3. Signed authorizations cannot be redirected or replayed.
if (open) {
    const user = privateKeyToAccount(generatePrivateKey());
    const goal = keccak256(toHex(`redteam ${Date.now()}`));
    const cohortId = BigInt(open.id);
    const nonce = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [cohortId, goal]));
    const validBefore = BigInt(open.stake_deadline) + 3600n;
    const sig = parseSignature(
        await user.signTypedData({
            domain: { ...cfg.tokenDomain, chainId: cfg.chainId, verifyingContract: cfg.token },
            types: {
                ReceiveWithAuthorization: [
                    { name: 'from', type: 'address' },
                    { name: 'to', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'validAfter', type: 'uint256' },
                    { name: 'validBefore', type: 'uint256' },
                    { name: 'nonce', type: 'bytes32' },
                ],
            },
            primaryType: 'ReceiveWithAuthorization',
            message: { from: user.address, to: pool, value: BigInt(open.stake_amount), validAfter: 0n, validBefore, nonce },
        }),
    );
    const v = Number(sig.v);
    const stakeArgs = (g: Hex, c: bigint) => [c, user.address, g, 0n, validBefore, nonce, v, sig.r, sig.s];

    await expectRevert('onchain_redirect_auth', 'relayer swaps in a different goal for a valid signature', treasury, 'stakeWithAuthorization', stakeArgs(keccak256(toHex('other goal')), cohortId), 'BadNonce');
    const other = cfg.cohorts.find((c: any) => c.id !== open.id);
    if (other) {
        await expectRevert('onchain_redirect_auth', 'signature reused for another cohort', treasury, 'stakeWithAuthorization', stakeArgs(goal, BigInt(other.id)), 'BadNonce');
    }

    // Real stake, then replay the exact same call.
    await relayer('/drip', { address: user.address });
    await relayer('/stake', {
        cohort_id: open.id,
        staker: user.address,
        goal_hash: goal,
        authorization: { validAfter: '0', validBefore: validBefore.toString(), nonce, v, r: sig.r, s: sig.s },
    });
    await new Promise((r) => setTimeout(r, 4000)); // let the public RPC catch up
    await expectRevert('onchain_replay_auth', 'replay a used stake authorization', treasury, 'stakeWithAuthorization', stakeArgs(goal, cohortId), 'AlreadyStaked');
} else {
    results.push({ category: 'onchain_replay_auth', attack: 'replay a used stake authorization', outcome: 'skipped', detail: 'no cohort open for staking' });
}

// 4. Double claim (needs a settled cohort).
if (settled) {
    const logs = await client.getContractEvents({ address: pool, abi, eventName: 'Claimed', args: { cohortId: BigInt(settled.id) }, fromBlock: BigInt(dep.deployBlock) });
    const claimed = (logs[0] as any)?.args?.staker as Address | undefined;
    if (claimed) await expectRevert('onchain_double_claim', 'claim the same stake twice', stranger, 'claimFor', [BigInt(settled.id), claimed], 'AlreadyClaimed');
    else results.push({ category: 'onchain_double_claim', attack: 'claim the same stake twice', outcome: 'skipped', detail: 'no claims yet in settled cohort' });
} else {
    results.push({ category: 'onchain_double_claim', attack: 'claim the same stake twice', outcome: 'skipped', detail: 'no settled cohort yet' });
}

// 5. Operator cannot withdraw: no function in the ABI moves funds anywhere but to a staker.
const writes = (abi as any[]).filter((f) => f.type === 'function' && f.stateMutability !== 'view' && f.stateMutability !== 'pure').map((f) => f.name);
const expected = ['claimFor', 'createCohort', 'postVerdict', 'settle', 'stakeWithAuthorization'];
const extra = writes.filter((w) => !expected.includes(w));
results.push({
    category: 'onchain_operator_withdraw',
    attack: 'operator looks for a withdraw / sweep / owner function',
    outcome: extra.length ? 'fooled' : 'caught',
    detail: extra.length ? `unexpected writes: ${extra.join(', ')}` : `only state-changing functions: ${writes.sort().join(', ')}`,
});

mkdirSync(resolve(here, '../results'), { recursive: true });
writeFileSync(resolve(here, '../results/onchain.json'), JSON.stringify({ ran_at: new Date().toISOString(), pool, results }, null, 2) + '\n');
console.table(results.map((r) => ({ category: r.category, outcome: r.outcome, detail: r.detail.slice(0, 70) })));
