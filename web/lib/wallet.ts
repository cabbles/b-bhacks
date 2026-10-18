"use client";
import { formatUnits } from "viem";
import { useConnection } from "wagmi";
import { client, erc20Abi } from "./chain";
import { MOCK_CHAIN, REFEREE_URL } from "./env";

// Per referee, so goals staked against fixtures never show up (and 404) on the live site.
const MY_GOALS_KEY = `ref.myGoals:${REFEREE_URL || "mock"}`;

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

/** The connected browser wallet, or null. Connecting happens in components/Wallet.tsx. */
export function useWallet() {
  const c = useConnection();
  const address = c.status === "connected" ? c.address : undefined;
  return { account: address ? { address } : null, status: c.status, connector: c.connector };
}

// ---------- my goals (local index so the join screen can link back) ----------

export type MyGoal = { goal_id: string; cohort_id: number; goal_text: string; created_at: string };

export function myGoals(): MyGoal[] {
  try {
    return JSON.parse(safeGet(MY_GOALS_KEY) || "[]");
  } catch {
    return [];
  }
}
export function rememberGoal(g: MyGoal) {
  safeSet(MY_GOALS_KEY, JSON.stringify([g, ...myGoals().filter((x) => x.goal_id !== g.goal_id)]));
}

// ---------- token reads ----------

const erc20 = erc20Abi;

let decimalsCache: number | null = null;
export async function tokenDecimals(token: `0x${string}`, fromConfig?: number): Promise<number> {
  if (typeof fromConfig === "number") return (decimalsCache = fromConfig);
  if (decimalsCache !== null) return decimalsCache;
  if (MOCK_CHAIN) return (decimalsCache = 6);
  try {
    decimalsCache = await client.readContract({ address: token, abi: erc20, functionName: "decimals" });
  } catch {
    decimalsCache = 6;
  }
  return decimalsCache;
}

export async function tokenBalance(token: `0x${string}`, who: `0x${string}`): Promise<bigint | null> {
  if (MOCK_CHAIN) return 100_000_000n;
  try {
    return await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });
  } catch {
    return null;
  }
}

export function fmtAmount(raw: string | bigint, decimals = 6): string {
  const n = Number(formatUnits(BigInt(raw), decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
