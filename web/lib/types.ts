// Mirrors PLAN.md section 4. Replace with imports from shared/ once the scaffold lands.

export type GoalType = "github_commits" | "url_live" | "canvas_submission";
export type GoalStatus = "watching" | "passed" | "failed" | "needs_human";

export const CHECK_NAMES = [
  "repo_control",
  "commits_in_window",
  "substance",
  "url_control",
  "url_content",
  "not_live_at_stake",
  "canvas_submitted",
  "canvas_min_bytes",
] as const;

export type Criteria = {
  version: 1;
  type: GoalType;
  staker: `0x${string}`;
  goal_text: string;
  window: { start: string; deadline: string };
  nonce: string;
  params: Record<string, unknown>;
};

export type Check = { name: string; passed: boolean; detail: string };
export type Evidence = { kind: string; ref: string; first_seen: string };

export type Verdict = {
  version: 1;
  cohort_id: number;
  staker: `0x${string}`;
  goal_hash: `0x${string}`;
  passed: boolean;
  checks: Check[];
  reasons: string;
  evidence: Evidence[];
  model_votes: { model: string; passed: boolean }[];
  human_override: boolean;
  decided_at: string;
};

export type CompileResponse = {
  criteria: Criteria;
  goal_hash: `0x${string}`;
  summary: string;
  /** Referee's instruction text for proving control (agent-b addition). */
  control_proof?: string;
};

export type GoalResponse = {
  status: GoalStatus;
  criteria: Criteria;
  verdict?: Verdict;
  verdict_tx_hash?: string;
  stake_tx_hash?: string;
  cohort_id?: number;
  goal_id?: number | string;
  goal_hash?: `0x${string}`;
  evidence_hash?: `0x${string}`;
  human_override?: boolean;
};

export type Cohort = {
  id: number;
  rule_hash?: string;
  stake_deadline: number; // unix seconds
  goal_deadline: number; // unix seconds
  stake_amount: string; // raw token units
  settled?: boolean;
  staker_count?: number;
};

export type CohortGoal = {
  goal_id: number | string;
  staker: string;
  status: GoalStatus;
  goal_text?: string;
  type?: GoalType;
  human_override?: boolean;
};

export type CohortStats = {
  stakers: number;
  passed: number;
  failed: number;
  watching: number;
  needs_human: number;
  pot: string; // raw token units
  human_overrides?: number;
};

export type CohortResponse = { cohort: Cohort; goals: CohortGoal[]; stats: CohortStats };

/** Contract addresses and cohorts, read from the chain (lib/api.ts getConfig). */
export type ChainConfig = {
  market_pool?: `0x${string}` | null;
  bond_pool?: `0x${string}` | null;
  chainId: number;
  /** Placeholder zero address until the pool is deployed. */
  pool: `0x${string}`;
  poolDeployed: boolean;
  decimals?: number;
  token: `0x${string}`;
  cohorts: Cohort[];
};


export type PredictionMarket = {
  address: `0x${string}`;
  market_id: `0x${string}`;
  cohort_id: number;
  owner: `0x${string}`;
  yes_total: string;
  no_total: string;
  result: number; // 0 pending, 1 YES, 2 NO, 3 refund
  betting_deadline: number;
  goal_deadline: number;
  settled: boolean;
  outcome: number;
  yes_amount: string;
  no_amount: string;
  claimed: boolean;
  claimable: string;
};
