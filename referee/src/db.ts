// One async database interface with two backends: D1 on Cloudflare Workers (db-d1.ts) and
// better-sqlite3 for local runs and tests (db-sqlite.ts). Both are SQLite, so the SQL is shared.

export type RunResult = { changes: number; lastId: number };
export type Statement = [sql: string, ...params: unknown[]];

export interface Db {
    get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
    all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
    run(sql: string, ...params: unknown[]): Promise<RunResult>;
    /** All statements succeed or none do. */
    batch(statements: Statement[]): Promise<void>;
}

let current: Db | null = null;
export function setDb(d: Db) {
    current = d;
}
export function db(): Db {
    if (!current) throw new Error('database not initialised (setDb)');
    return current;
}

/** SQLite binds only numbers, strings, bigints, blobs and null. */
export const bindable = (p: unknown) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p);

export const SCHEMA = `
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
    last_polled_at INTEGER,                -- ms; the worker polls GitHub at most every GITHUB_POLL_MS
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
-- Keeper: who staked and bet (from contract events), how far the event scan got, and rounds fully paid out.
-- Keyed by pool address: cohort ids restart at 1 after a redeploy.
CREATE TABLE IF NOT EXISTS keeper_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keeper_stakers (pool TEXT NOT NULL, cohort_id INTEGER NOT NULL, staker TEXT NOT NULL, PRIMARY KEY (pool, cohort_id, staker));
CREATE TABLE IF NOT EXISTS keeper_bettors (
    pool TEXT NOT NULL, cohort_id INTEGER NOT NULL, owner TEXT NOT NULL, bettor TEXT NOT NULL,
    PRIMARY KEY (pool, cohort_id, owner, bettor)
);
CREATE TABLE IF NOT EXISTS keeper_done (pool TEXT NOT NULL, cohort_id INTEGER NOT NULL, done_at TEXT NOT NULL, PRIMARY KEY (pool, cohort_id));
-- "Connect GitHub": wallet -> GitHub account, with the sign-in token encrypted (github-auth.ts).
CREATE TABLE IF NOT EXISTS github_links (wallet TEXT PRIMARY KEY, github_id INTEGER NOT NULL, login TEXT NOT NULL, token_enc TEXT NOT NULL, refresh_enc TEXT, linked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, wallet TEXT NOT NULL, return_path TEXT NOT NULL DEFAULT '/stake', expires_ms INTEGER NOT NULL);
-- Short-lived locks so overlapping cron runs never do the same work twice.
CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, until_ms INTEGER NOT NULL);
-- Rate limiting that holds across Worker instances (in-memory counters would not).
CREATE TABLE IF NOT EXISTS rate_hits (key TEXT NOT NULL, at_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key ON rate_hits (key, at_ms);
`;

/** The schema as single statements (D1 cannot run multi-line statements in one exec). */
export const schemaStatements = () =>
    SCHEMA.replace(/--[^\n]*/g, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

let schemaReady: Promise<void> | null = null;
/** Create missing tables and columns, once per process or isolate. */
export function ensureSchema(): Promise<void> {
    schemaReady ??= (async () => {
        await db().batch(schemaStatements().map((s) => [s] as Statement));
        // Databases created before last_polled_at existed.
        await db().run('ALTER TABLE goals ADD COLUMN last_polled_at INTEGER').catch(() => {});
    })();
    return schemaReady;
}

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
    last_polled_at: number | null;
    created_at: string;
    decided_at: string | null;
};

export const nowIso = () => new Date().toISOString();

export function getGoal(id: number): Promise<GoalRow | undefined> {
    return db().get<GoalRow>('SELECT * FROM goals WHERE id = ?', id);
}

export async function observe(goalId: number, kind: string, ref: string, data: unknown, preWindow = false) {
    // INSERT OR IGNORE keeps the first time the referee saw this ref.
    await db().run(
        'INSERT OR IGNORE INTO observations (goal_id, kind, ref, first_seen, pre_window, data_json) VALUES (?, ?, ?, ?, ?, ?)',
        goalId, kind, ref, nowIso(), preWindow ? 1 : 0, JSON.stringify(data ?? null),
    );
}

/** observe() for many refs at once, in one batch (a commit snapshot can hold hundreds of SHAs). */
export async function observeMany(goalId: number, kind: string, refs: Iterable<string>, preWindow: boolean) {
    const at = nowIso();
    const statements: Statement[] = [...refs].map((ref) => [
        'INSERT OR IGNORE INTO observations (goal_id, kind, ref, first_seen, pre_window, data_json) VALUES (?, ?, ?, ?, ?, ?)',
        goalId, kind, ref, at, preWindow ? 1 : 0, 'null',
    ]);
    for (let i = 0; i < statements.length; i += 100) await db().batch(statements.slice(i, i + 100));
}

export type ObservationRow = {
    goal_id: number;
    kind: string;
    ref: string;
    first_seen: string;
    pre_window: number;
    data_json: string | null;
};

export function observations(goalId: number, kind: string): Promise<ObservationRow[]> {
    return db().all<ObservationRow>('SELECT * FROM observations WHERE goal_id = ? AND kind = ? ORDER BY first_seen', goalId, kind);
}

/** Run fn only if no other process holds the named lease; the lease expires after ttlMs in case we die. */
export async function withLease(name: string, ttlMs: number, fn: () => Promise<void>): Promise<boolean> {
    const now = Date.now();
    const got = await db().run(
        'INSERT INTO leases (name, until_ms) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET until_ms = excluded.until_ms WHERE leases.until_ms < ?',
        name, now + ttlMs, now,
    );
    if (got.changes === 0) return false;
    try {
        await fn();
    } finally {
        await db().run('DELETE FROM leases WHERE name = ?', name).catch(() => {});
    }
    return true;
}

/** Count a hit for key; false once there are already `limit` hits in the last windowMs. */
export async function rateAllowed(key: string, limit: number, windowMs: number): Promise<boolean> {
    const since = Date.now() - windowMs;
    const row = await db().get<{ n: number }>('SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND at_ms > ?', key, since);
    if ((row?.n ?? 0) >= limit) return false;
    await db().run('INSERT INTO rate_hits (key, at_ms) VALUES (?, ?)', key, Date.now());
    // Opportunistic cleanup keeps the table small.
    if (Math.random() < 0.05) await db().run('DELETE FROM rate_hits WHERE at_ms < ?', since).catch(() => {});
    return true;
}
