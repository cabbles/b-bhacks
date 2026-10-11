"use client";
import { useEffect, useState } from "react";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bytesToHex, createPublicClient, formatUnits, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { drip } from "./api";
import { MOCK, RPC_URL } from "./env";
import type { Authorization, RelayerConfig } from "./types";

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

  useEffect(() => {
    const acct = loadAccount();
    setAccount(acct);
    const prior = safeGet(DRIP_KEY + ":" + acct.address);
    if (prior) {
      setDripState("done");
      setDripTx(prior === "1" ? null : prior);
      return;
    }
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
  }, []);

  return { account, dripState, dripTx };
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

// ---------- ERC-3009 ----------

/**
 * Sign ReceiveWithAuthorization. `to` is the pool: the pool calls
 * token.receiveWithAuthorization, so only the pool can redeem this signature.
 */
export async function signStakeAuthorization(
  account: PrivateKeyAccount,
  cfg: RelayerConfig,
  value: bigint,
  ttlSeconds = 3600,
): Promise<Authorization> {
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Math.floor(Date.now() / 1000);
  const validAfter = 0n;
  const validBefore = BigInt(now + ttlSeconds);
  const sig = await account.signTypedData({
    domain: {
      name: cfg.tokenDomain.name,
      version: cfg.tokenDomain.version,
      chainId: cfg.chainId,
      verifyingContract: cfg.token,
    },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: cfg.pool, value, validAfter, validBefore, nonce },
  });
  const r = ("0x" + sig.slice(2, 66)) as `0x${string}`;
  const s = ("0x" + sig.slice(66, 130)) as `0x${string}`;
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  return { validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce, v, r, s };
}

// ---------- token reads ----------

const erc20 = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);
const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

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
