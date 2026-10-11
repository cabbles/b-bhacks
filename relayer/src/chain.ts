import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createPublicClient,
    createWalletClient,
    http,
    nonceManager,
    parseAbi,
    type Abi,
    type Address,
    type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../.env') });
loadEnv({ path: resolve(here, '../../.env') });

const shared = resolve(here, '../../shared');
const readJson = (p: string) => JSON.parse(readFileSync(resolve(shared, p), 'utf8'));

export const deployments = readJson('deployments.json') as {
    chainId: number;
    pool: Address | null;
    token: Address;
    referee: Address;
    deployBlock?: number;
};
if (process.env.POOL_ADDRESS) deployments.pool = process.env.POOL_ADDRESS as Address; // local fork testing
export const poolAbi = readJson('abi/StakePool.json') as Abi;

export const tokenAbi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function transfer(address to, uint256 value) returns (bool)',
    'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
]);
// Agora testnet faucet: requestFunds(address) mints AUSD to the caller-specified address.
export const FAUCET: Address = '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C';
export const faucetAbi = parseAbi(['function requestFunds(address to)']);

const env = process.env;
if (!env.RPC_URL) throw new Error('RPC_URL is required');
if (!env.TREASURY_PRIVATE_KEY) throw new Error('TREASURY_PRIVATE_KEY is required');

export const chain = baseSepolia;
export const publicClient = createPublicClient({ chain, transport: http(env.RPC_URL) });
// nonceManager lets concurrent requests send transactions from the one treasury key.
export const treasury = privateKeyToAccount(env.TREASURY_PRIVATE_KEY as Hex, { nonceManager });
export const wallet = createWalletClient({ account: treasury, chain, transport: http(env.RPC_URL) });

export function requirePool(): Address {
    if (!deployments.pool) throw new Error('pool not deployed yet (shared/deployments.json)');
    return deployments.pool;
}

/** Simulate first so reverts come back as readable errors, then send and wait for the receipt. */
export async function send(args: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }) {
    const { request } = await publicClient.simulateContract({ ...args, account: treasury } as any);
    const hash = await wallet.writeContract(request as any);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') throw new Error(`transaction reverted: ${hash}`);
    return { hash, receipt };
}

/** Short revert reason for API responses (e.g. "BadNonce", "StakingClosed"). */
export function reason(err: unknown): string {
    const e = err as any;
    const name = e?.cause?.data?.errorName ?? e?.walk?.((x: any) => x?.data?.errorName)?.data?.errorName;
    if (name) return name;
    return String(e?.shortMessage ?? e?.message ?? err).split('\n')[0].slice(0, 300);
}
