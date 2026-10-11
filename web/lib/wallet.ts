"use client";
import { useEffect, useState } from "react";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { formatUnits } from "viem";
import { client, erc20Abi } from "./chain";
import { drip } from "./api";
import { MOCK_RELAYER, RELAYER_URL } from "./env";

const KEY = "ref.pk";
// Per relayer, so a mock-mode drip never stops the real faucet from running for this address.
const DRIP_KEY = `ref.dripped:${RELAYER_URL || "mock"}`;
const MY_GOALS_KEY = "ref.myGoals";

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

/** Load or create the in-browser burner key. Testnet only. */
export function loadAccount(): PrivateKeyAccount {
  let pk = safeGet(KEY) as `0x${string}` | null;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    pk = generatePrivateKey();
    safeSet(KEY, pk);
  }
  return privateKeyToAccount(pk);
}

export type DripState = "idle" | "pending" | "done" | "error";

// One /drip request per address per page load (React StrictMode runs effects twice in dev).
const inflight = new Map<string, Promise<{ tx_hash: string }>>();
function dripOnce(address: string) {
  let p = inflight.get(address);
  if (!p) {
    p = drip(address).finally(() => setTimeout(() => inflight.delete(address), 0));
    inflight.set(address, p);
  }
  return p;
}

/** The wallet hook: creates the key on first visit and calls /drip once. */
export function useWallet() {
  const [account, setAccount] = useState<PrivateKeyAccount | null>(null);
  const [dripState, setDripState] = useState<DripState>("idle");
  const [dripTx, setDripTx] = useState<string | null>(null);

  const requestDrip = (acct: PrivateKeyAccount) => {
    setDripState("pending");
    dripOnce(acct.address)
      .then((r) => {
        // Only remember a drip the relayer confirmed with a tx; a bare "already dripped" may be a request still in flight.
        if (r.tx_hash) safeSet(DRIP_KEY + ":" + acct.address, r.tx_hash);
        setDripTx(r.tx_hash);
        setDripState("done");
      })
      .catch((e: Error) => {
        if (/already|once/i.test(e.message)) setDripState("done");
        else setDripState("error");
      });
  };

  useEffect(() => {
    const acct = loadAccount();
    setAccount(acct);
    const prior = safeGet(DRIP_KEY + ":" + acct.address);
    if (prior?.startsWith("0x")) {
      setDripState("done");
      setDripTx(prior);
      return;
    }
    requestDrip(acct);
  }, []);

  const retryDrip = () => account && requestDrip(account);
  return { account, dripState, dripTx, retryDrip };
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

export { signStakeAuthorization } from "./erc3009";

// ---------- token reads ----------

const erc20 = erc20Abi;

let decimalsCache: number | null = null;
export async function tokenDecimals(token: `0x${string}`, fromConfig?: number): Promise<number> {
  if (typeof fromConfig === "number") return (decimalsCache = fromConfig);
  if (decimalsCache !== null) return decimalsCache;
  if (MOCK_RELAYER) return (decimalsCache = 6);
  try {
    decimalsCache = await client.readContract({ address: token, abi: erc20, functionName: "decimals" });
  } catch {
    decimalsCache = 6;
  }
  return decimalsCache;
}

export async function tokenBalance(token: `0x${string}`, who: `0x${string}`): Promise<bigint | null> {
  if (MOCK_RELAYER) return 100_000_000n;
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
