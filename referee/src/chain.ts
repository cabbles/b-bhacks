import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { chainReady, config, signerReady } from './config.ts';

// Only the frozen interface (PLAN 4.1); no dependency on the compiled ABI file.
export const poolAbi = parseAbi([
    'function postVerdict(uint256 cohortId, address staker, bool passed, bytes32 evidenceHash) external',
    'event CohortCreated(uint256 indexed cohortId, bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount)',
    'event Staked(uint256 indexed cohortId, address indexed staker, bytes32 goalHash)',
    'event Verdict(uint256 indexed cohortId, address indexed staker, bool passed, bytes32 evidenceHash)',
]);

const chain = config.chainId === 11155111 ? sepolia : baseSepolia;
const transport = http(config.rpcUrl || undefined);
export const publicClient = createPublicClient({ chain, transport });
const wallet = signerReady()
    ? createWalletClient({ chain, transport, account: privateKeyToAccount(config.refereeKey as Hex) })
    : null;

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
    const logs = await publicClient.getLogs({
        address: config.pool as Hex,
        event: poolAbi[1],
        args: { cohortId: BigInt(id) },
        fromBlock: config.deployBlock,
        toBlock: 'latest',
    });
    const log = logs[0];
    if (!log) return null;
    const a = log.args as any;
    const cohort: Cohort = {
        id,
        rule_hash: a.ruleHash,
        stake_deadline: Number(a.stakeDeadline),
        goal_deadline: Number(a.goalDeadline),
        stake_amount: a.stakeAmount.toString(),
    };
    cohortCache.set(id, cohort);
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

export async function postVerdictOnChain(cohortId: number, staker: string, passed: boolean, evidenceHash: Hex): Promise<Hex> {
    if (!wallet) throw new Error('referee signer not configured');
    const { request } = await publicClient.simulateContract({
        account: wallet.account,
        address: config.pool as Hex,
        abi: poolAbi,
        functionName: 'postVerdict',
        args: [BigInt(cohortId), staker as Hex, passed, evidenceHash],
    });
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return hash;
}

/** If a verdict is already on chain (e.g. after a crash mid-post), return its tx hash. */
export async function findPostedVerdict(cohortId: number, staker: string): Promise<{ tx: Hex; evidenceHash: string } | null> {
    if (!chainReady()) return null;
    const logs = await publicClient.getLogs({
        address: config.pool as Hex,
        event: poolAbi[3],
        args: { cohortId: BigInt(cohortId), staker: staker as Hex },
        fromBlock: config.deployBlock,
        toBlock: 'latest',
    });
    const log = logs[0];
    return log ? { tx: log.transactionHash, evidenceHash: (log.args as any).evidenceHash } : null;
}
