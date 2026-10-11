// End-to-end smoke test of the relayer against any RPC (anvil fork or Base Sepolia).
// Acts as the web app: new wallet -> /drip -> sign ERC-3009 -> /stake.
// Optional on a local anvil fork (SMOKE_FORK=1): time-travel, post verdict as REFEREE_KEY, settle, claim.
//   RELAYER=http://localhost:8788 COHORT=1 [SMOKE_FORK=1 REFEREE_KEY=0x.. RPC_URL=.. ADMIN_KEY=..] tsx scripts/smoke.ts
import {
    createPublicClient,
    createWalletClient,
    encodeAbiParameters,
    http,
    keccak256,
    parseSignature,
    toHex,
    type Address,
    type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const RELAYER = process.env.RELAYER ?? 'http://localhost:8788';
const COHORT = BigInt(process.env.COHORT ?? '1');

async function call(path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${RELAYER}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json();
    console.log(res.status, path, JSON.stringify(json).slice(0, 300));
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return json;
}

const cfg = await call('/config');
const cohort = cfg.cohorts.find((c: any) => BigInt(c.id) === COHORT);
if (!cohort) throw new Error(`cohort ${COHORT} not found`);

const user = privateKeyToAccount(generatePrivateKey());
console.log('user', user.address);
await call('/drip', { address: user.address });
await fetch(`${RELAYER}/drip`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: user.address }) })
    .then((r) => console.log(r.status, '/drip again (expect 409)'));

const goalHash = keccak256(toHex('smoke goal ' + Date.now()));
const nonce = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [COHORT, goalHash]));
const validBefore = BigInt(cohort.stake_deadline) + 3600n;
const sig = await user.signTypedData({
    domain: { ...cfg.tokenDomain, chainId: cfg.chainId, verifyingContract: cfg.token as Address },
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
    message: { from: user.address, to: cfg.pool, value: BigInt(cohort.stake_amount), validAfter: 0n, validBefore, nonce },
});
const { v, r, s } = parseSignature(sig);
const authorization = { validAfter: '0', validBefore: validBefore.toString(), nonce, v: Number(v), r, s };
await call('/stake', { cohort_id: Number(COHORT), staker: user.address, goal_hash: goalHash, authorization });

// Replay the same authorization: must fail (AlreadyStaked or auth used).
await call('/stake', { cohort_id: Number(COHORT), staker: user.address, goal_hash: goalHash, authorization }).catch(() =>
    console.log('replay rejected as expected'),
);

if (process.env.SMOKE_FORK === '1') {
    const rpc = process.env.RPC_URL!;
    const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
    const ref = createWalletClient({ account: privateKeyToAccount(process.env.REFEREE_KEY as Hex), chain: baseSepolia, transport: http(rpc) });
    const abi = (await import('../../shared/abi/StakePool.json', { with: { type: 'json' } })).default as any;
    const jump = async (to: number) => {
        await pub.request({ method: 'evm_setNextBlockTimestamp' as any, params: [toHex(to)] as any });
        await pub.request({ method: 'evm_mine' as any, params: [] as any });
    };
    await jump(cohort.goal_deadline + 1);
    const h = await ref.writeContract({ address: cfg.pool, abi, functionName: 'postVerdict', args: [COHORT, user.address, true, keccak256(toHex('evidence'))] });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log('verdict posted', h);
    await jump(cohort.goal_deadline + 601);
    await call('/admin/settle', { cohort_id: Number(COHORT) }, { 'x-admin-key': process.env.ADMIN_KEY! });
    await call('/claim', { cohort_id: Number(COHORT), staker: user.address });
    await call('/claim', { cohort_id: Number(COHORT), staker: user.address }).catch(() => console.log('double claim rejected as expected'));
    console.log('done');
}
