import { MOCK_REFEREE, MOCK_RELAYER, REFEREE_URL, RELAYER_URL } from "./env";
import * as fx from "./fixtures";
import type {
  Attack,
  AttackCategory,
  Authorization,
  Cohort,
  CohortResponse,
  CompileResponse,
  Criteria,
  GoalResponse,
  GoalType,
  RelayerConfig,
} from "./types";

// ngrok free domains serve an HTML interstitial instead of JSON unless this header is sent.
export const TUNNEL_HEADERS = { "ngrok-skip-browser-warning": "1" };

async function http<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...TUNNEL_HEADERS, ...(init?.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (res.status === 409 && (body as { tx_hash?: string })?.tx_hash) return body as T; // e.g. "already dripped"
  if (!res.ok) {
    const msg = (body as { error?: string; message?: string })?.error || (body as { message?: string })?.message || res.statusText;
    throw new Error(`${path}: ${msg}`);
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The relayer may send cohorts in camelCase (chain field names) or snake_case. Normalize once here.
export function normalizeCohort(c: Record<string, unknown>): Cohort {
  const pick = (...keys: string[]) => keys.map((k) => c[k]).find((v) => v !== undefined && v !== null);
  return {
    id: Number(pick("id", "cohortId", "cohort_id")),
    rule_hash: pick("rule_hash", "ruleHash") as string | undefined,
    stake_deadline: Number(pick("stake_deadline", "stakeDeadline")),
    goal_deadline: Number(pick("goal_deadline", "goalDeadline")),
    stake_amount: String(pick("stake_amount", "stakeAmount") ?? "0"),
    settled: Boolean(pick("settled")),
  };
}

// ---------- Relayer ----------

export async function getConfig(): Promise<RelayerConfig> {
  if (MOCK_RELAYER) return fx.fxConfig;
  const c = await http<Omit<RelayerConfig, "pool" | "poolDeployed"> & { pool: `0x${string}` | null; cohorts: Record<string, unknown>[] }>(
    RELAYER_URL,
    "/config",
  );
  const poolDeployed = !!c.pool && !/^0x0{40}$/i.test(c.pool);
  return {
    ...c,
    pool: c.pool ?? "0x0000000000000000000000000000000000000000",
    poolDeployed,
    cohorts: (c.cohorts || []).map(normalizeCohort),
  };
}

export async function drip(address: string): Promise<{ tx_hash: string }> {
  if (MOCK_RELAYER) return delay(300).then(() => ({ tx_hash: fx.FX_TX }));
  return http(RELAYER_URL, "/drip", post({ address }));
}

export async function relayStake(args: {
  cohort_id: number;
  staker: string;
  goal_hash: string;
  authorization: Authorization;
}): Promise<{ tx_hash: string }> {
  if (MOCK_RELAYER) return delay(600).then(() => ({ tx_hash: fx.FX_TX }));
  return http(RELAYER_URL, "/stake", post(args));
}

export async function relayClaim(cohort_id: number, staker: string): Promise<{ tx_hash: string }> {
  if (MOCK_RELAYER) return delay(300).then(() => ({ tx_hash: fx.FX_TX }));
  return http(RELAYER_URL, "/claim", post({ cohort_id, staker }));
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

// ---------- mock store: goals staked in mock mode live in localStorage and get a verdict after MOCK_JUDGE_MS ----------

const MOCK_GOALS_KEY = "ref.mockGoals";
const MOCK_JUDGE_MS = 20_000;
type MockGoal = GoalResponse & { created_ms: number; is_attack?: boolean; attack_category?: string; attack_note?: string };

function mockGoals(): Record<string, MockGoal> {
  try {
    return JSON.parse(localStorage.getItem(MOCK_GOALS_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Mock judging: honest goals pass, declared cheat attempts are caught. */
function judged(g: MockGoal): GoalResponse {
  // Entries saved before created_ms existed are treated as already judged.
  const created = Number.isFinite(g.created_ms) ? g.created_ms : Date.now() - MOCK_JUDGE_MS;
  if (Date.now() - created < MOCK_JUDGE_MS) return g;
  const passed = !g.is_attack;
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
  is_attack?: boolean;
  attack_category?: AttackCategory;
  attack_note?: string;
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
      is_attack: args.is_attack,
      attack_category: args.attack_category,
      attack_note: args.attack_note,
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
        return { goal_id, staker: j.criteria.staker, status: j.status, goal_text: j.criteria.goal_text, type: j.criteria.type, is_attack: g.is_attack };
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
      attacks: (base.stats.attacks ?? 0) + Object.values(mockGoals()).filter((g) => g.is_attack).length,
    };
    return { ...base, goals, stats };
  }
  const r = await http<CohortResponse & { cohort: Record<string, unknown> }>(REFEREE_URL, `/cohorts/${id}`);
  let cohort = normalizeCohort(r.cohort);
  // The referee returns just { id } when it cannot read the chain; fall back to the relayer's copy.
  if (!Number.isFinite(cohort.stake_deadline) || !Number.isFinite(cohort.goal_deadline)) {
    const fromRelayer = await getConfig()
      .then((c) => c.cohorts.find((x) => x.id === id))
      .catch(() => undefined);
    if (fromRelayer) cohort = fromRelayer;
  }
  const pot = r.stats?.pot && r.stats.pot !== "0" ? r.stats.pot : (BigInt(cohort.stake_amount) * BigInt(r.goals.length)).toString();
  return { ...r, cohort, stats: { ...r.stats, pot } };
}

export async function getAttacks(): Promise<Attack[]> {
  if (MOCK_REFEREE) {
    const mine: Attack[] = Object.entries(mockGoals())
      .filter(([, g]) => g.is_attack)
      .map(([goal_id, g]) => {
        const j = judged(g);
        return {
          goal_id,
          category: g.attack_category ?? "other",
          note: g.attack_note ?? "",
          outcome: j.verdict ? (j.verdict.passed ? "fooled" : "caught") : null,
          decided_at: j.verdict?.decided_at ?? null,
        };
      });
    return [...fx.fxAttacks, ...mine];
  }
  return http(REFEREE_URL, "/attacks");
}
