// Direct chain access for the red team: read cohorts, fund throwaway wallets, stake on their behalf.
// REDTEAM_PRIVATE_KEY pays gas (a little Base Sepolia ETH); it never needs AUSD.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createPublicClient,
    createWalletClient,
    encodeAbiParameters,
    http,
    keccak256,
    nonceManager,
    parseAbi,
    parseEventLogs,
    parseSignature,
    type Address,
    type Hex,
    type PrivateKeyAccount,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const here = dirname(fileURLToPath(import.meta.url));
export const dep = JSON.parse(readFileSync(resolve(here, '../../shared/deployments.json'), 'utf8'));
export const pool = dep.pool as Address;
const token = dep.token as Address;
const FAUCET: Address = '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C';

const transport = http(process.env.RPC_URL ?? 'https://sepolia.base.org');
export const client = createPublicClient({ chain: baseSepolia, transport });

const poolAbi = parseAbi([
    'event CohortCreated(uint256 indexed cohortId, bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount)',
    'function cohortCount() view returns (uint256)',
    'function cohorts(uint256) view returns (bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount, uint32 stakerCount, uint32 passCount, uint32 failCount, bool settled, uint256 forfeitPool)',
    'function createCohort(bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount) returns (uint256)',
    'function stakeWithAuthorization(uint256 cohortId, address staker, bytes32 goalHash, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
]);
const tokenAbi = parseAbi([
    'function eip712Domain() view returns (bytes1, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
]);
const faucetAbi = parseAbi(['function requestFunds(address to)']);

export type Cohort = { id: number; stake_deadline: number; goal_deadline: number; stake_amount: string; settled: boolean };

export async function readCohorts(): Promise<Cohort[]> {
    const count = Number(await client.readContract({ address: pool, abi: poolAbi, functionName: 'cohortCount' }));
    const out: Cohort[] = [];
    for (let id = 1; id <= count; id++) {
        const c = await client.readContract({ address: pool, abi: poolAbi, functionName: 'cohorts', args: [BigInt(id)] });
        out.push({ id, stake_deadline: Number(c[1]), goal_deadline: Number(c[2]), stake_amount: c[3].toString(), settled: c[7] });
    }
    return out;
}

let funder: ReturnType<typeof createWalletClient> & { account: PrivateKeyAccount } | null = null;
function wallet() {
    if (!funder) {
        const key = process.env.REDTEAM_PRIVATE_KEY as Hex | undefined;
        if (!key) throw new Error('REDTEAM_PRIVATE_KEY is required (pays gas for faucet requests and stakes)');
        funder = createWalletClient({ chain: baseSepolia, transport, account: privateKeyToAccount(key, { nonceManager }) }) as any;
    }
    return funder!;
}

async function send(address: Address, abi: any, functionName: string, args: readonly unknown[]) {
    const w = wallet();
    const { request } = await client.simulateContract({ account: w.account, address, abi, functionName, args } as any);
    const hash = await w.writeContract(request as any);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted in ${hash}`);
    return { hash, receipt };
}

/** Test AUSD from the Agora faucet to any address; the funder pays the gas. */
export const fund = (to: Address) => send(FAUCET, faucetAbi, 'requestFunds', [to]);

export async function createCohort(stakeMinutes: number, goalMinutes: number, stakeAmount: bigint): Promise<Cohort> {
    const now = Math.floor(Date.now() / 1000);
    const stakeDeadline = now + stakeMinutes * 60;
    const goalDeadline = stakeDeadline + goalMinutes * 60;
    const { receipt } = await send(pool, poolAbi, 'createCohort', [`0x${'0'.repeat(64)}`, BigInt(stakeDeadline), BigInt(goalDeadline), stakeAmount]);
    const ev = parseEventLogs({ abi: poolAbi, logs: receipt.logs, eventName: 'CohortCreated' })[0];
    return { id: Number(ev.args.cohortId), stake_deadline: stakeDeadline, goal_deadline: goalDeadline, stake_amount: stakeAmount.toString(), settled: false };
}

export const stakeNonce = (cohortId: bigint, goalHash: Hex) =>
    keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [cohortId, goalHash]));

/** The user's ERC-3009 ReceiveWithAuthorization for a stake, as StakePool.stakeWithAuthorization arguments. */
export async function signStake(user: PrivateKeyAccount, cohort: Cohort, goalHash: Hex) {
    const [, name, version, chainId] = await client.readContract({ address: token, abi: tokenAbi, functionName: 'eip712Domain' });
    const nonce = stakeNonce(BigInt(cohort.id), goalHash);
    const validBefore = BigInt(cohort.stake_deadline) + 3600n;
    const sig = parseSignature(
        await user.signTypedData({
            domain: { name, version, chainId: Number(chainId), verifyingContract: token },
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
            message: { from: user.address, to: pool, value: BigInt(cohort.stake_amount), validAfter: 0n, validBefore, nonce },
        }),
    );
    return { nonce, validBefore, v: Number(sig.v), r: sig.r, s: sig.s };
}

/** Submit a signed stake; the funder pays gas, the AUSD comes from the user's signature. */
export async function submitStake(user: Address, cohort: Cohort, goalHash: Hex, a: Awaited<ReturnType<typeof signStake>>) {
    const { hash } = await send(pool, poolAbi, 'stakeWithAuthorization', [BigInt(cohort.id), user, goalHash, 0n, a.validBefore, a.nonce, a.v, a.r, a.s]);
    return hash;
}
