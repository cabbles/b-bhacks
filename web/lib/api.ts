import { getAddress } from "viem";
import { ADDRESSES, MOCK_CHAIN, MOCK_REFEREE, REFEREE_URL } from "./env";
import { bondAbi, client, erc20Abi, marketAbi, marketIdOf, poolAbi } from "./chain";
import * as fx from "./fixtures";
import { isMarket } from "./kinds";
import type {
  ChainConfig,
  Cohort,
  CohortResponse,
  CompileResponse,
  Criteria,
  GoalResponse,
  GoalType,
  PredictionMarket,
} from "./types";

async function http<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    ...init,
    // Only POSTs carry a JSON body; a plain GET stays a "simple" request with no CORS preflight.
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const msg = (body as { error?: string; message?: string })?.error || (body as { message?: string })?.message || res.statusText;
    throw new Error(`${path}: ${msg}`);
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The referee may send cohorts in camelCase (chain field names) or snake_case. Normalize once here.
export function normalizeCohort(c: Record<string, unknown>): Cohort {
  const pick = (...keys: string[]) => keys.map((k) => c[k]).find((v) => v !== undefined && v !== null);
  return {
    id: Number(pick("id", "cohortId", "cohort_id")),
    rule_hash: pick("rule_hash", "ruleHash") as string | undefined,
    stake_deadline: Number(pick("stake_deadline", "stakeDeadline")),
    goal_deadline: Number(pick("goal_deadline", "goalDeadline")),
    stake_amount: String(pick("stake_amount", "stakeAmount") ?? "0"),
    settled: Boolean(pick("settled")),
    staker_count: pick("staker_count", "stakerCount") !== undefined ? Number(pick("staker_count", "stakerCount")) : undefined,
  };
}

// ---------- Chain reads (straight from the contracts; no server in between) ----------

let decimalsCache: number | null = null;
async function tokenDecimalsOnChain(): Promise<number> {
  if (decimalsCache === null) decimalsCache = await client.readContract({ address: ADDRESSES.token, abi: erc20Abi, functionName: "decimals" });
  return decimalsCache;
}

/** Contract addresses plus every cohort, read in one multicall. */
export async function getConfig(): Promise<ChainConfig> {
  if (MOCK_CHAIN) return fx.fxConfig;
  const pool = ADDRESSES.pool!;
  const [count, decimals] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: "cohortCount" }),
    tokenDecimalsOnChain(),
  ]);
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
  const rows = await Promise.all(ids.map((id) => client.readContract({ address: pool, abi: poolAbi, functionName: "cohorts", args: [id] })));
  return {
    chainId: client.chain.id,
    pool,
    poolDeployed: true,
    market_pool: ADDRESSES.market,
    bond_pool: ADDRESSES.bond,
    token: ADDRESSES.token,
    decimals,
    cohorts: rows.map((c, i) => ({
      id: i + 1,
      rule_hash: c[0],
      stake_deadline: Number(c[1]),
      goal_deadline: Number(c[2]),
      stake_amount: c[3].toString(),
      staker_count: Number(c[4]),
      settled: c[7],
    })),
  };
}

// ---------- Referee ----------

export async function compileGoal(args: {
  text: string;
  staker: `0x${string}`;
  type_hint?: GoalType;
  /** Makes the referee use the cohort's goal deadline; without it POST /goals can reject the criteria. */
  cohort_id?: number;
}): Promise<CompileResponse> {
  if (MOCK_REFEREE) return delay(700).then(() => fx.fxCompile(args.text, args.staker, args.type_hint));
  return http(REFEREE_URL, "/goals/compile", post(args));
}

// ---------- Connect GitHub (the referee checks you can push to a task's repo) ----------

export type GithubStatus = { configured: boolean; linked: boolean; login: string | null };

/** Must match referee/src/github-auth.ts linkMessage exactly: the referee verifies this signature. */
export const githubLinkMessage = (action: "connect" | "disconnect", wallet: `0x${string}`, issuedAt: string) =>
  `Cash Cow: ${action} GitHub ${action === "connect" ? "to" : "from"} wallet ${getAddress(wallet)}\nIssued at: ${issuedAt}`;

export async function getGithubStatus(wallet: `0x${string}`): Promise<GithubStatus> {
  if (MOCK_REFEREE) return { configured: true, linked: true, login: "mock-user" };
  return http(REFEREE_URL, `/auth/github/status?wallet=${wallet}`);
}

/** Returns GitHub's sign-in URL; the referee sends the browser back to returnPath afterwards. */
export async function startGithubConnect(args: { wallet: `0x${string}`; signature: `0x${string}`; issued_at: string; return_path: string }): Promise<{ url: string }> {
  return http(REFEREE_URL, "/auth/github/start", post(args));
}

export async function disconnectGithub(args: { wallet: `0x${string}`; signature: `0x${string}`; issued_at: string }): Promise<{ linked: false }> {
  return http(REFEREE_URL, "/auth/github/disconnect", post(args));
}

// ---------- mock store: goals staked in mock mode live in localStorage and get a verdict after MOCK_JUDGE_MS ----------

const MOCK_GOALS_KEY = "ref.mockGoals";
const MOCK_JUDGE_MS = 20_000;
type MockGoal = GoalResponse & { created_ms: number };

function mockGoals(): Record<string, MockGoal> {
  try {
    return JSON.parse(localStorage.getItem(MOCK_GOALS_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Mock judging: every goal passes after MOCK_JUDGE_MS. */
function judged(g: MockGoal): GoalResponse {
  // Entries saved before created_ms existed are treated as already judged.
  const created = Number.isFinite(g.created_ms) ? g.created_ms : Date.now() - MOCK_JUDGE_MS;
  if (Date.now() - created < MOCK_JUDGE_MS) return g;
  const passed = true;
  return {
    ...g,
    status: passed ? "passed" : "failed",
    verdict: fx.mockVerdict(g.criteria, g.cohort_id ?? 1, passed, new Date(created + MOCK_JUDGE_MS).toISOString()),
    verdict_tx_hash: fx.FX_TX,
  };
}

export async function submitGoal(args: {
  cohort_id: number;
  criteria: Criteria;
  stake_tx_hash: string;
}): Promise<{ goal_id: number | string }> {
  if (MOCK_REFEREE) {
    const goal_id = "m" + Date.now().toString(36);
    const all = mockGoals();
    all[goal_id] = {
      status: "watching",
      criteria: args.criteria,
      stake_tx_hash: args.stake_tx_hash,
      cohort_id: args.cohort_id,
      created_ms: Date.now(),
    };
    try {
      localStorage.setItem(MOCK_GOALS_KEY, JSON.stringify(all));
    } catch {}
    return { goal_id };
  }
  return http(REFEREE_URL, "/goals", post(args));
}

export async function getGoal(id: string): Promise<GoalResponse> {
  if (MOCK_REFEREE) {
    const m = mockGoals()[id];
    const g = fx.fxGoal(id) || (m && judged(m));
    if (!g) throw new Error(`goal ${id} not found`);
    return g;
  }
  return http(REFEREE_URL, `/goals/${encodeURIComponent(id)}`);
}

export async function getCohort(id: number): Promise<CohortResponse> {
  if (MOCK_REFEREE) {
    const base = fx.fxCohort();
    const mine = Object.entries(mockGoals())
      .filter(([, g]) => (g.cohort_id ?? 1) === id)
      .map(([goal_id, g]) => {
        const j = judged(g);
        return { goal_id, staker: j.criteria.staker, status: j.status, goal_text: j.criteria.goal_text, type: j.criteria.type };
      });
    const goals = [...mine, ...base.goals];
    const count = (st: string) => goals.filter((g) => g.status === st).length;
    const stats = {
      ...base.stats,
      stakers: goals.length,
      passed: count("passed"),
      failed: count("failed"),
      watching: count("watching"),
      needs_human: count("needs_human"),
      pot: (BigInt(base.cohort.stake_amount) * BigInt(goals.length)).toString(),
    };
    return { ...base, goals, stats };
  }
  const r = await http<CohortResponse & { cohort: Record<string, unknown> }>(REFEREE_URL, `/cohorts/${id}`);
  let cohort = normalizeCohort(r.cohort);
  // The referee returns just { id } when it cannot read the chain; fall back to reading it here.
  if (!Number.isFinite(cohort.stake_deadline) || !Number.isFinite(cohort.goal_deadline)) {
    const fromChain = await getConfig()
      .then((c) => c.cohorts.find((x) => x.id === id))
      .catch(() => undefined);
    if (fromChain) cohort = fromChain;
  }
  const pot = r.stats?.pot && r.stats.pot !== "0" ? r.stats.pot : (BigInt(cohort.stake_amount) * BigInt(r.goals.length)).toString();
  return { ...r, cohort, stats: { ...r.stats, pot } };
}


// Separate YES/NO funds; reads only. Bets, resolves and claims are sent from the wallet (lib/tx.ts).
export async function getPredictionMarket(cohort: number, owner: `0x${string}`, bettor: `0x${string}`): Promise<PredictionMarket> {
  const market = ADDRESSES.market;
  if (MOCK_CHAIN || !market) throw new Error("Betting is not deployed yet.");
  const id = BigInt(cohort);
  const key = marketIdOf(id, owner);
  // One block keeps totals, verdict and balances consistent with each other.
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [m, c, st, p, claimable] = await Promise.all([
    client.readContract({ address: market, abi: marketAbi, functionName: "markets", args: [key], blockNumber }),
    client.readContract({ address: ADDRESSES.pool!, abi: poolAbi, functionName: "cohorts", args: [id], blockNumber }),
    client.readContract({ address: ADDRESSES.pool!, abi: poolAbi, functionName: "stakes", args: [id, owner], blockNumber }),
    client.readContract({ address: market, abi: marketAbi, functionName: "positions", args: [key, bettor], blockNumber }),
    client.readContract({ address: market, abi: marketAbi, functionName: "claimable", args: [id, owner, bettor], blockNumber }),
  ]);
  if (/^0x0{64}$/.test(st[0])) throw new Error("The task owner has no commitment in this market.");
  return {
    address: market,
    market_id: key,
    cohort_id: cohort,
    owner,
    yes_total: m[0].toString(),
    no_total: m[1].toString(),
    result: Number(m[2]),
    betting_deadline: Number(c[1]),
    goal_deadline: Number(c[2]),
    settled: c[7],
    outcome: Number(st[1]),
    yes_amount: p[0].toString(),
    no_amount: p[1].toString(),
    claimed: p[2],
    claimable: claimable.toString(),
  };
}

// ---------- Markets I created ----------

export type MyMarket = { cohort: Cohort; stake: string; stakeResult: "pending" | "returned" | "to_no" | "burned" };

/** Every market where this wallet is the creator (it holds the market's commitment), newest first. */
export async function getMyMarkets(me: `0x${string}`): Promise<MyMarket[]> {
  if (MOCK_CHAIN) return [];
  const cfg = await getConfig();
  const markets = cfg.cohorts.filter((c) => isMarket(c));
  const mine = await Promise.all(
    markets.map((c) => client.readContract({ address: ADDRESSES.pool!, abi: poolAbi, functionName: "stakes", args: [BigInt(c.id), me] })),
  );
  const owned = markets.filter((_, i) => !/^0x0{64}$/.test(mine[i][0]));
  const bonds = await Promise.all(owned.map((c) => (ADDRESSES.bond ? getBond(c.id, me).catch(() => null) : null)));
  return owned
    .map((cohort, i) => ({ cohort, stake: bonds[i]?.amount ?? "0", stakeResult: bonds[i]?.result ?? "pending" }))
    .sort((a, b) => b.cohort.id - a.cohort.id);
}

// ---------- Commitment bond (the task owner's separate stake in a prediction market) ----------

const BOND_RESULT = ["pending", "returned", "to_no", "burned"] as const;

export async function getBond(cohortId: number, owner: `0x${string}`, bettor?: `0x${string}`): Promise<{ amount: string; result: (typeof BOND_RESULT)[number]; claimable: string }> {
  const bond = ADDRESSES.bond;
  if (MOCK_CHAIN || !bond) throw new Error("Bonds are not deployed yet.");
  const [b, claimable] = await Promise.all([
    client.readContract({ address: bond, abi: bondAbi, functionName: "bonds", args: [marketIdOf(cohortId, owner)] }),
    bettor ? client.readContract({ address: bond, abi: bondAbi, functionName: "claimable", args: [BigInt(cohortId), owner, bettor] }) : 0n,
  ]);
  return { amount: b[0].toString(), result: BOND_RESULT[b[1]] ?? "pending", claimable: claimable.toString() };
}
