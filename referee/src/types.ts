import { keccak256, toBytes } from 'viem';
// The one canonical JSON implementation (PLAN 4.4). Never re-implement it here.
import { canonical } from '../../shared/canonical.ts';

export { canonical };

export type GoalType = 'github_commits' | 'url_live' | 'canvas_submission';

export type Criteria = {
    version: 1;
    type: GoalType;
    staker: string;
    goal_text: string;
    window: { start: string; deadline: string };
    nonce: string;
    params: Record<string, unknown>;
};

export type GithubParams = { repo: string; branch: string; min_commits: number };
export type UrlParams = { url: string; must_contain: string };
export type CanvasParams = { course_id: number; assignment_id: number; min_bytes: number };

export type CheckName =
    | 'repo_control'
    | 'commits_in_window'
    | 'substance'
    | 'url_control'
    | 'url_content'
    | 'not_live_at_stake'
    | 'canvas_submitted'
    | 'canvas_min_bytes';

export type Check = { name: CheckName; passed: boolean; detail: string };
export type Evidence = { kind: string; ref: string; first_seen: string };
export type ModelVote = { model: string; passed: boolean };

export type Verdict = {
    version: 1;
    cohort_id: number;
    staker: string;
    goal_hash: string;
    passed: boolean;
    checks: Check[];
    reasons: string;
    evidence: Evidence[];
    model_votes: ModelVote[];
    human_override: boolean;
    decided_at: string;
};

export const hashJson = (obj: unknown) => keccak256(toBytes(canonical(obj)));
