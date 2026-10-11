"use client";
import { useEffect, useState } from "react";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { formatUnits } from "viem";
import { client, erc20Abi } from "./chain";
import { drip } from "./api";
import { MOCK } from "./env";

const KEY = "ref.pk";
const DRIP_KEY = "ref.dripped";
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

/** The wallet hook: creates the key on first visit and calls /drip once. */
export function useWallet() {
  const [account, setAccount] = useState<PrivateKeyAccount | null>(null);
  const [dripState, setDripState] = useState<DripState>("idle");
  const [dripTx, setDripTx] = useState<string | null>(null);

  const requestDrip = (acct: PrivateKeyAccount) => {
    setDripState("pending");
    drip(acct.address)
      .then((r) => {
        safeSet(DRIP_KEY + ":" + acct.address, r.tx_hash || "1");
        setDripTx(r.tx_hash);
        setDripState("done");
      })
      .catch((e: Error) => {
        // "already dripped" counts as done; anything else is surfaced.
        if (/already|once/i.test(e.message)) {
          safeSet(DRIP_KEY + ":" + acct.address, "1");
          setDripState("done");
        } else setDripState("error");
      });
  };

  useEffect(() => {
    const acct = loadAccount();
    setAccount(acct);
    const prior = safeGet(DRIP_KEY + ":" + acct.address);
    if (prior) {
      setDripState("done");
      setDripTx(prior === "1" ? null : prior);
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
export async function tokenDecimals(token: `0x${string}`): Promise<number> {
  if (decimalsCache !== null) return decimalsCache;
  if (MOCK) return (decimalsCache = 6);
  try {
    decimalsCache = await client.readContract({ address: token, abi: erc20, functionName: "decimals" });
  } catch {
    decimalsCache = 6;
  }
  return decimalsCache;
}

export async function tokenBalance(token: `0x${string}`, who: `0x${string}`): Promise<bigint | null> {
  if (MOCK) return 100_000_000n;
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
