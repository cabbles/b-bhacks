import { MOCK, REFEREE_URL, RELAYER_URL } from "./env";
import * as fx from "./fixtures";
import type {
  Attack,
  Authorization,
  Cohort,
  CohortResponse,
  CompileResponse,
  Criteria,
  GoalResponse,
  GoalType,
  RelayerConfig,
} from "./types";

async function http<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
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
  if (MOCK) return fx.fxConfig;
  const c = await http<RelayerConfig & { cohorts: Record<string, unknown>[] }>(RELAYER_URL, "/config");
  return { ...c, cohorts: (c.cohorts || []).map(normalizeCohort) };
}

export async function drip(address: string): Promise<{ tx_hash: string }> {
  if (MOCK) return delay(300).then(() => ({ tx_hash: fx.FX_TX }));
  return http(RELAYER_URL, "/drip", post({ address }));
}

export async function relayStake(args: {
  cohort_id: number;
  staker: string;
  goal_hash: string;
  authorization: Authorization;
}): Promise<{ tx_hash: string }> {
  if (MOCK) return delay(600).then(() => ({ tx_hash: fx.FX_TX }));
  return http(RELAYER_URL, "/stake", post(args));
}

export async function relayClaim(cohort_id: number, staker: string): Promise<{ tx_hash: string }> {
  if (MOCK) return delay(300).then(() => ({ tx_hash: fx.FX_TX }));
  return http(RELAYER_URL, "/claim", post({ cohort_id, staker }));
}

// ---------- Referee ----------

export async function compileGoal(text: string, staker: `0x${string}`, type_hint?: GoalType): Promise<CompileResponse> {
  if (MOCK) return delay(700).then(() => fx.fxCompile(text, staker, type_hint));
  return http(REFEREE_URL, "/goals/compile", post({ text, staker, type_hint }));
}

const MOCK_GOALS_KEY = "ref.mockGoals";
function mockGoals(): Record<string, GoalResponse> {
  try {
    return JSON.parse(localStorage.getItem(MOCK_GOALS_KEY) || "{}");
  } catch {
    return {};
  }
}

export async function submitGoal(args: {
  cohort_id: number;
  criteria: Criteria;
  stake_tx_hash: string;
  is_attack?: boolean;
  attack_note?: string;
}): Promise<{ goal_id: string }> {
  if (MOCK) {
    const goal_id = "m" + Date.now().toString(36);
    const all = mockGoals();
    all[goal_id] = { status: "watching", criteria: args.criteria, stake_tx_hash: args.stake_tx_hash, cohort_id: args.cohort_id };
    try {
      localStorage.setItem(MOCK_GOALS_KEY, JSON.stringify(all));
    } catch {}
    return { goal_id };
  }
  return http(REFEREE_URL, "/goals", post(args));
}

export async function getGoal(id: string): Promise<GoalResponse> {
  if (MOCK) {
    const g = fx.fxGoals[id] || mockGoals()[id];
    if (!g) throw new Error(`goal ${id} not found`);
    return g;
  }
  return http(REFEREE_URL, `/goals/${encodeURIComponent(id)}`);
}

export async function getCohort(id: number): Promise<CohortResponse> {
  if (MOCK) return fx.fxCohort();
  const r = await http<CohortResponse & { cohort: Record<string, unknown> }>(REFEREE_URL, `/cohorts/${id}`);
  return { ...r, cohort: normalizeCohort(r.cohort) };
}

export async function getAttacks(): Promise<Attack[]> {
  if (MOCK) return fx.fxAttacks;
  return http(REFEREE_URL, "/attacks");
}
