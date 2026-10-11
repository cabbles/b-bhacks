import Database from 'better-sqlite3';
import { config } from './config.ts';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cohort_id INTEGER NOT NULL,
    staker TEXT NOT NULL,
    goal_hash TEXT NOT NULL,
    type TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    stake_tx_hash TEXT NOT NULL,
    cohort_goal_deadline INTEGER,          -- unix seconds, from chain
    is_attack INTEGER NOT NULL DEFAULT 0,  -- never read by the verdict engine
    attack_category TEXT,
    attack_note TEXT,
    status TEXT NOT NULL DEFAULT 'watching',
    snapshot_json TEXT,
    verdict_json TEXT,
    evidence_hash TEXT,
    verdict_tx_hash TEXT,
    human_override INTEGER NOT NULL DEFAULT 0,
    override_note TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    UNIQUE (cohort_id, staker)
);
CREATE TABLE IF NOT EXISTS observations (
    goal_id INTEGER NOT NULL,
    kind TEXT NOT NULL,       -- github_commit | url_fetch | canvas_submission
    ref TEXT NOT NULL,        -- sha, or phase:timestamp
    first_seen TEXT NOT NULL, -- referee clock, ISO-8601 UTC
    pre_window INTEGER NOT NULL DEFAULT 0,
    data_json TEXT,
    PRIMARY KEY (goal_id, kind, ref)
);
`);

export type GoalRow = {
    id: number;
    cohort_id: number;
    staker: string;
    goal_hash: string;
    type: string;
    criteria_json: string;
    stake_tx_hash: string;
    cohort_goal_deadline: number | null;
    is_attack: number;
    attack_category: string | null;
    attack_note: string | null;
    status: 'watching' | 'passed' | 'failed' | 'needs_human';
    snapshot_json: string | null;
    verdict_json: string | null;
    evidence_hash: string | null;
    verdict_tx_hash: string | null;
    human_override: number;
    override_note: string | null;
    last_error: string | null;
    created_at: string;
    decided_at: string | null;
};

export const nowIso = () => new Date().toISOString();

export function getGoal(id: number): GoalRow | undefined {
    return db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as GoalRow | undefined;
}

export function observe(goalId: number, kind: string, ref: string, data: unknown, preWindow = false) {
    // INSERT OR IGNORE keeps the first time the referee saw this ref.
    db.prepare(
        'INSERT OR IGNORE INTO observations (goal_id, kind, ref, first_seen, pre_window, data_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(goalId, kind, ref, nowIso(), preWindow ? 1 : 0, JSON.stringify(data ?? null));
}

export type ObservationRow = {
    goal_id: number;
    kind: string;
    ref: string;
    first_seen: string;
    pre_window: number;
    data_json: string | null;
};

export function observations(goalId: number, kind: string): ObservationRow[] {
    return db
        .prepare('SELECT * FROM observations WHERE goal_id = ? AND kind = ? ORDER BY first_seen')
        .all(goalId, kind) as ObservationRow[];
}
