import { createPublicClient, createWalletClient, decodeEventLog, http, nonceManager, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { chainReady, config, signerReady } from './config.ts';

// Only the frozen interface (PLAN 4.1); no dependency on the compiled ABI file.
export const poolAbi = parseAbi([
    'function postVerdict(uint256 cohortId, address staker, bool passed, bytes32 evidenceHash) external',
    'event CohortCreated(uint256 indexed cohortId, bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount)',
    'event Staked(uint256 indexed cohortId, address indexed staker, bytes32 goalHash)',
    'event Verdict(uint256 indexed cohortId, address indexed staker, bool passed, bytes32 evidenceHash)',
    // Public getters. Preferred over getLogs: the public Base Sepolia RPC caps getLogs at 200 blocks.
    'function cohortCount() view returns (uint256)',
    'function cohorts(uint256) view returns (bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount, uint32 stakerCount, uint32 passCount, uint32 failCount, bool settled, uint256 forfeitPool)',
    'function stakes(uint256, address) view returns (bytes32 goalHash, uint8 outcome, bool claimed)',
]);

export const chain = config.chainId === 11155111 ? sepolia : baseSepolia;
// JSON-RPC batching: concurrent reads share one HTTP request (Workers caps outbound requests per run).
export const transport = http(config.rpcUrl || undefined, { batch: true });
export const publicClient = createPublicClient({ chain, transport });
const wallet = signerReady()
    ? createWalletClient({ chain, transport, account: privateKeyToAccount(config.refereeKey as Hex, { nonceManager }) })
    : null;

/** The referee key's public address (null if unset), for the health check. */
export const signerAddress = () => wallet?.account.address ?? null;

/** The referee the pool contract will accept verdicts from. */
export async function poolReferee(): Promise<string | null> {
    if (!chainReady()) return null;
    return publicClient.readContract({ address: config.pool as Hex, abi: parseAbi(['function referee() view returns (address)']), functionName: 'referee' });
}

export type Cohort = {
    id: number;
    rule_hash: string;
    stake_deadline: number;
    goal_deadline: number;
    stake_amount: string;
};

const cohortCache = new Map<number, Cohort>();

export async function getCohort(id: number): Promise<Cohort | null> {
    if (cohortCache.has(id)) return cohortCache.get(id)!;
    if (!chainReady()) return null;
    const [ruleHash, stakeDeadline, goalDeadline, stakeAmount] = await publicClient.readContract({
        address: config.pool as Hex,
        abi: poolAbi,
        functionName: 'cohorts',
        args: [BigInt(id)],
    });
    if (stakeAmount === 0n) return null; // unknown cohort
    const cohort: Cohort = {
        id,
        rule_hash: ruleHash,
        stake_deadline: Number(stakeDeadline),
        goal_deadline: Number(goalDeadline),
        stake_amount: stakeAmount.toString(),
    };
    cohortCache.set(id, cohort); // cohort parameters are immutable once created
    return cohort;
}

/** Confirm stake_tx_hash emitted Staked(cohortId, staker, goalHash). Retries while the tx is pending. */
export async function verifyStake(txHash: Hex, cohortId: number, staker: string, goalHash: string): Promise<string | null> {
    if (!chainReady()) return 'chain not configured';
    let receipt;
    try {
        receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    } catch {
        return 'stake transaction not found';
    }
    if (receipt.status !== 'success') return 'stake transaction reverted';
    for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== (config.pool as string).toLowerCase()) continue;
        try {
            const ev = decodeEventLog({ abi: poolAbi, data: log.data, topics: log.topics });
            if (ev.eventName !== 'Staked') continue;
            const a = ev.args as any;
            if (
                Number(a.cohortId) === cohortId &&
                a.staker.toLowerCase() === staker.toLowerCase() &&
                a.goalHash.toLowerCase() === goalHash.toLowerCase()
            )
                return null;
        } catch {}
    }
    return 'stake transaction has no matching Staked event';
}

// One referee wallet. Sends go through a queue (and viem's nonce manager) so concurrent posts never
// race for a nonce; confirmations are awaited in parallel so a full room posts in well under a minute.
let sendQueue: Promise<unknown> = Promise.resolve();

export async function postVerdictOnChain(
    cohortId: number,
    staker: string,
    passed: boolean,
    evidenceHash: Hex,
    onSent: (hash: Hex) => unknown,
): Promise<Hex> {
    const send = sendQueue.then(() => sendVerdict(cohortId, staker, passed, evidenceHash));
    sendQueue = send.catch(() => {});
    const hash = await send;
    await onSent(hash); // record before waiting, so a crash here never loses the tx hash
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== 'success') throw new Error(`postVerdict reverted in ${hash}`);
    return hash;
}

async function sendVerdict(cohortId: number, staker: string, passed: boolean, evidenceHash: Hex): Promise<Hex> {
    if (!wallet) throw new Error('referee signer not configured');
    const { request } = await publicClient.simulateContract({
        account: wallet.account,
        address: config.pool as Hex,
        abi: poolAbi,
        functionName: 'postVerdict',
        args: [BigInt(cohortId), staker as Hex, passed, evidenceHash],
    });
    return wallet.writeContract(request);
}

/** Whether a verdict for this staker is already on chain (e.g. after a crash mid-post). */
export async function verdictPosted(cohortId: number, staker: string): Promise<{ passed: boolean } | null> {
    if (!chainReady()) return null;
    const [, outcome] = await publicClient.readContract({
        address: config.pool as Hex,
        abi: poolAbi,
        functionName: 'stakes',
        args: [BigInt(cohortId), staker as Hex],
    });
    return outcome === 0 ? null : { passed: outcome === 1 };
}

/** The cohort currently open for staking (latest created whose stake deadline has not passed). */
export async function getOpenCohort(): Promise<Cohort | null> {
    if (!chainReady()) return null;
    const count = Number(await publicClient.readContract({ address: config.pool as Hex, abi: poolAbi, functionName: 'cohortCount' }));
    const now = Date.now() / 1000;
    for (let id = count; id >= 1; id--) {
        const c = await getCohort(id);
        if (c && c.stake_deadline > now) return c;
    }
    return null;
}

/* ------------------------------------------------------------------ x402 */

export const tokenAbi = parseAbi([
    'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) external',
    'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
    'function balanceOf(address) view returns (uint256)',
]);

export type Authorization = { from: Hex; to: Hex; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex };

/** Dry-run an ERC-3009 transfer: proves the signature, balance and nonce are good without moving funds. */
export async function simulatePayment(token: Hex, auth: Authorization, signature: Hex): Promise<void> {
    if (!wallet) throw new Error('referee signer not configured');
    await publicClient.simulateContract({
        account: wallet.account,
        address: token,
        abi: tokenAbi,
        functionName: 'transferWithAuthorization',
        args: [auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, signature],
    });
}

/** Execute the ERC-3009 transfer (referee pays gas). Shares the verdict send queue so nonces never collide. */
export async function settlePayment(token: Hex, auth: Authorization, signature: Hex): Promise<Hex> {
    const send = sendQueue.then(async () => {
        const { request } = await publicClient.simulateContract({
            account: wallet!.account,
            address: token,
            abi: tokenAbi,
            functionName: 'transferWithAuthorization',
            args: [auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, signature],
        });
        return wallet!.writeContract(request);
    });
    sendQueue = send.catch(() => {});
    const hash = await send;
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== 'success') throw new Error(`payment transfer reverted in ${hash}`);
    return hash;
}

/** EIP-191 signature by the referee key over an evidence hash, so third parties can verify who ruled. */
export async function signAttestation(hash: Hex): Promise<{ signer: Hex; signature: Hex }> {
    if (!wallet) throw new Error('referee signer not configured');
    return { signer: wallet.account.address, signature: await wallet.account.signMessage({ message: { raw: hash } }) };
}
