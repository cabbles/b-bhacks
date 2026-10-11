// Mock-mode data, built from shared/fixtures (PLAN.md 4.7) with times shifted to "now"
// so countdowns and staking windows behave during a rehearsal.
import cfgJson from "@shared/fixtures/api/relayer.config.response.json";
import cohortJson from "@shared/fixtures/api/cohort.get.response.json";
import attacksJson from "@shared/fixtures/api/attacks.get.response.json";
import compileJson from "@shared/fixtures/api/compile.response.json";
import crGithub from "@shared/fixtures/criteria.github_commits.json";
import crUrl from "@shared/fixtures/criteria.url_live.json";
import crCanvas from "@shared/fixtures/criteria.canvas_submission.json";
import vGithub from "@shared/fixtures/verdict.github_commits.json";
import vUrl from "@shared/fixtures/verdict.url_live.json";
import vCanvas from "@shared/fixtures/verdict.canvas_submission.json";
import type {
  Attack,
  Cohort,
  CohortResponse,
  CompileResponse,
  Criteria,
  GoalResponse,
  GoalType,
  RelayerConfig,
  Verdict,
} from "./types";

const iso = (s: number) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

// Shift the fixture cohort so staking closes 15 minutes after page load.
const SHIFT = Math.floor(Date.now() / 1000) + 15 * 60 - cfgJson.cohorts[0].stake_deadline;
const COHORT: Cohort = {
  ...cfgJson.cohorts[0],
  stake_deadline: cfgJson.cohorts[0].stake_deadline + SHIFT,
  goal_deadline: cfgJson.cohorts[0].goal_deadline + SHIFT,
};
const WINDOW = { start: iso(COHORT.stake_deadline - 30 * 60), deadline: iso(COHORT.goal_deadline) };

export const fxConfig: RelayerConfig = {
  ...(cfgJson as unknown as RelayerConfig),
  pool: "0x000000000000000000000000000000000000dEaD",
  poolDeployed: true,
  token: "0x000000000000000000000000000000000000bEEF",
  cohorts: [COHORT],
};

const CRITERIA: Record<GoalType, Criteria> = {
  github_commits: { ...(crGithub as Criteria), window: WINDOW },
  url_live: { ...(crUrl as Criteria), window: WINDOW },
  canvas_submission: { ...(crCanvas as Criteria), window: WINDOW },
};
const VERDICTS: Record<GoalType, Verdict> = {
  github_commits: vGithub as Verdict,
  url_live: vUrl as Verdict,
  canvas_submission: vCanvas as Verdict,
};

export const FX_TX = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

export const fxCohort = (): CohortResponse => ({
  ...(cohortJson as unknown as CohortResponse),
  cohort: COHORT,
});

/** GET /goals/:id for the goals listed in the cohort fixture. */
export function fxGoal(id: string): GoalResponse | undefined {
  const g = cohortJson.goals.find((x) => String(x.goal_id) === id);
  if (!g) return undefined;
  const type = g.type as GoalType;
  const criteria: Criteria = { ...CRITERIA[type], staker: g.staker as `0x${string}`, goal_text: g.goal_text };
  const base: GoalResponse = { goal_id: g.goal_id, status: g.status as GoalResponse["status"], criteria, cohort_id: COHORT.id, stake_tx_hash: FX_TX };
  if (g.status !== "passed" && g.status !== "failed") return base;
  const passed = g.status === "passed";
  const fixture = VERDICTS[type];
  const verdict =
    fixture.passed === passed && fixture.staker.toLowerCase() === g.staker.toLowerCase()
      ? fixture
      : mockVerdict(criteria, COHORT.id, passed, WINDOW.deadline);
  return { ...base, verdict, verdict_tx_hash: FX_TX, human_override: verdict.human_override };
}

export const fxAttacks: Attack[] = attacksJson as Attack[];

export const fxCompile = (text: string, staker: `0x${string}`, typeHint?: GoalType): CompileResponse => {
  const type: GoalType = typeHint || (/https?:\/\//.test(text) ? "url_live" : "github_commits");
  const nonce = "ref-" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  const criteria: Criteria = { ...CRITERIA[type], staker, goal_text: text, nonce };
  const p = criteria.params as Record<string, string | number>;
  const summary =
    type === "github_commits"
      ? `Push at least ${p.min_commits} new commits to ${p.repo} (${p.branch}) before the deadline.`
      : type === "url_live"
        ? `Make ${p.url} live and showing "${p.must_contain}" before the deadline.`
        : `Submit Canvas assignment ${p.assignment_id} before the deadline.`;
  return {
    ...(compileJson as unknown as CompileResponse),
    criteria,
    // Mock mode only: not a real hash of the criteria.
    goal_hash: compileJson.goal_hash as `0x${string}`,
    summary,
  };
};

/** Build a plausible verdict for a goal staked in mock mode. */
export function mockVerdict(criteria: Criteria, cohortId: number, passed: boolean, decidedAt: string): Verdict {
  const p = criteria.params as Record<string, string | number>;
  const checks =
    criteria.type === "url_live"
      ? [
          { name: "url_control", passed: true, detail: `nonce ${criteria.nonce} found at /.well-known/referee.txt` },
          { name: "not_live_at_stake", passed: true, detail: "required text absent at stake time" },
          { name: "url_content", passed, detail: passed ? `page contains "${p.must_contain}"` : `"${p.must_contain}" not found` },
          { name: "substance", passed, detail: passed ? "both models: page delivers the goal" : "both models: static placeholder, no working feature" },
        ]
      : [
          { name: "repo_control", passed: true, detail: `nonce file .referee/${criteria.nonce} found on ${p.branch ?? "main"}` },
          {
            name: "commits_in_window",
            passed,
            detail: passed
              ? `${p.min_commits ?? 2} of ${p.min_commits ?? 2} commits first seen inside the window`
              : "commits claim earlier author dates; only 0 were first seen inside the window",
          },
          { name: "substance", passed, detail: passed ? "both models: diffs implement the stated goal" : "skipped: earlier check failed" },
        ];
  return {
    version: 1,
    cohort_id: cohortId,
    staker: criteria.staker,
    goal_hash: compileJson.goal_hash as `0x${string}`,
    passed,
    checks,
    reasons: passed
      ? "The referee saw the work appear during the goal window and it matches what you said you would do."
      : "The evidence the referee observed itself does not show the goal being completed inside the window.",
    evidence: [
      {
        kind: criteria.type === "url_live" ? "url_snapshot" : "github_commit",
        ref: criteria.type === "url_live" ? String(p.url) : "c0ffee1",
        first_seen: decidedAt,
      },
    ],
    model_votes: [
      { model: "model-a", passed },
      { model: "model-b", passed },
    ],
    human_override: false,
    decided_at: decidedAt,
  };
}
