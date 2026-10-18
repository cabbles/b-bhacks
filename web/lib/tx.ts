import { encodeFunctionData, parseEventLogs, type Hex, type TransactionReceipt } from "viem";
import { baseSepolia } from "viem/chains";
import { getConnection, sendCalls, switchChain, waitForCallsStatus } from "wagmi/actions";
import { bondAbi, erc20Abi, faucetAbi, marketAbi, poolAbi } from "./chain";
import { ADDRESSES, MOCK_CHAIN } from "./env";
import * as fx from "./fixtures";
import { wagmiConfig } from "./wagmi";

export type Call = { to: `0x${string}`; data: Hex };

const need = (a: `0x${string}` | null, what: string) => {
  if (!a) throw new Error(`The ${what} contract is not deployed yet.`);
  return a;
};

/**
 * Send calls from the connected wallet and wait for them to land. Wallets that batch (EIP-5792, e.g. MetaMask's
 * smart account) confirm once; others confirm each call in turn. Throws if anything reverts.
 */
export async function send(calls: Call[]): Promise<{ hash: Hex; receipts: TransactionReceipt[] }> {
  if (MOCK_CHAIN) {
    await new Promise((r) => setTimeout(r, 600));
    return { hash: fx.FX_TX, receipts: [] };
  }
  const conn = getConnection(wagmiConfig);
  if (conn.status !== "connected") throw new Error("Connect a wallet first.");
  if (conn.chainId !== baseSepolia.id) await switchChain(wagmiConfig, { chainId: baseSepolia.id });

  const { id } = await sendCalls(wagmiConfig, {
    chainId: baseSepolia.id,
    calls,
    // Wallets without batching (EIP-5792) send the calls one by one instead.
    experimental_fallback: true,
  });
  const status = await waitForCallsStatus(wagmiConfig, { id, timeout: 120_000 });
  const receipts = (status.receipts ?? []) as unknown as TransactionReceipt[];
  if (status.status !== "success" || receipts.length === 0 || receipts.some((r) => r.status !== "success")) {
    throw new Error("A transaction failed on-chain. Check your wallet activity before trying again.");
  }
  return { hash: receipts[receipts.length - 1].transactionHash, receipts };
}

/** The receipt that emitted an event from `address`: a batch can span several transactions on fallback wallets. */
export function receiptFrom(receipts: TransactionReceipt[], address: `0x${string}`): TransactionReceipt | undefined {
  return receipts.find((r) => r.logs.some((l) => l.address.toLowerCase() === address.toLowerCase()));
}

// Each approval is for the exact amount, never unlimited, so a contract can only ever take what this action needs.
const approve = (spender: `0x${string}`, amount: bigint): Call => ({
  to: ADDRESSES.token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});

export const calls = {
  faucet: (to: `0x${string}`): Call[] => [
    { to: ADDRESSES.faucet, data: encodeFunctionData({ abi: faucetAbi, functionName: "requestFunds", args: [to] }) },
  ],
  createCohort: (ruleHash: Hex, stakeDeadline: number, goalDeadline: number, stakeAmount: bigint): Call[] => [
    {
      to: need(ADDRESSES.pool, "stake"),
      data: encodeFunctionData({
        abi: poolAbi,
        functionName: "createCohort",
        args: [ruleHash, BigInt(stakeDeadline), BigInt(goalDeadline), stakeAmount],
      }),
    },
  ],
  stake: (cohortId: number, goalHash: Hex, amount: bigint): Call[] => {
    const pool = need(ADDRESSES.pool, "stake");
    return [approve(pool, amount), { to: pool, data: encodeFunctionData({ abi: poolAbi, functionName: "stake", args: [BigInt(cohortId), goalHash] }) }];
  },
  bond: (cohortId: number, amount: bigint): Call[] => {
    const bond = need(ADDRESSES.bond, "bond");
    return [approve(bond, amount), { to: bond, data: encodeFunctionData({ abi: bondAbi, functionName: "bond", args: [BigInt(cohortId), amount] }) }];
  },
  bet: (cohortId: number, owner: `0x${string}`, yes: boolean, amount: bigint): Call[] => {
    const market = need(ADDRESSES.market, "betting");
    return [
      approve(market, amount),
      { to: market, data: encodeFunctionData({ abi: marketAbi, functionName: "bet", args: [BigInt(cohortId), owner, yes, amount] }) },
    ];
  },
  claimStake: (cohortId: number, staker: `0x${string}`): Call[] => [
    { to: need(ADDRESSES.pool, "stake"), data: encodeFunctionData({ abi: poolAbi, functionName: "claimFor", args: [BigInt(cohortId), staker] }) },
  ],
  resolveMarket: (cohortId: number, owner: `0x${string}`): Call[] => [
    { to: need(ADDRESSES.market, "betting"), data: encodeFunctionData({ abi: marketAbi, functionName: "resolve", args: [BigInt(cohortId), owner] }) },
  ],
  claimMarket: (cohortId: number, owner: `0x${string}`, bettor: `0x${string}`): Call[] => [
    {
      to: need(ADDRESSES.market, "betting"),
      data: encodeFunctionData({ abi: marketAbi, functionName: "claimFor", args: [BigInt(cohortId), owner, bettor] }),
    },
  ],
  claimBond: (cohortId: number, owner: `0x${string}`, bettor: `0x${string}`): Call[] => [
    { to: need(ADDRESSES.bond, "bond"), data: encodeFunctionData({ abi: bondAbi, functionName: "claimFor", args: [BigInt(cohortId), owner, bettor] }) },
  ],
};

/** The cohort id from a createCohort receipt. */
export function createdCohortId(receipts: TransactionReceipt[]): number {
  for (const r of receipts) {
    const ev = parseEventLogs({ abi: poolAbi, logs: r.logs, eventName: "CohortCreated" })[0];
    if (ev) return Number(ev.args.cohortId);
  }
  throw new Error("Market created, but its number was not found in the receipt.");
}
