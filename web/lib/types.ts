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
};

export type CohortGoal = {
  goal_id: number | string;
  staker: string;
  status: GoalStatus;
  goal_text?: string;
  type?: GoalType;
  is_attack?: boolean;
  human_override?: boolean;
};

export type CohortStats = {
  stakers: number;
  passed: number;
  failed: number;
  watching: number;
  needs_human: number;
  pot: string; // raw token units
  attacks?: number;
  human_overrides?: number;
};

export type CohortResponse = { cohort: Cohort; goals: CohortGoal[]; stats: CohortStats };

export type Attack = {
  goal_id: number | string;
  category: string;
  note: string;
  outcome: "caught" | "fooled" | null;
  decided_at: string | null;
};

export type RelayerConfig = {
  chainId: number;
  pool: `0x${string}`;
  token: `0x${string}`;
  tokenDomain: { name: string; version: string };
  cohorts: Cohort[];
};

export type Authorization = {
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
};

// Must match referee/src/routes.ts ATTACK_CATEGORIES; anything else is guessed from the note.
export const ATTACK_CATEGORIES = [
  "backdated_commits",
  "foreign_repo",
  "filler_commits",
  "prompt_injection",
  "fake_page",
  "other",
] as const;
export type AttackCategory = (typeof ATTACK_CATEGORIES)[number];

export const ATTACK_LABEL: Record<string, string> = {
  backdated_commits: "Backdated commits",
  foreign_repo: "Someone else's repo",
  filler_commits: "Filler commits",
  prompt_injection: "Prompt injection",
  fake_page: "Fake static page",
  static_fake: "Fake static page",
  other: "Other",
};
