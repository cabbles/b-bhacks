// Local backend (Node): better-sqlite3 behind the async Db interface. Never bundled into the Worker.
import Database from 'better-sqlite3';
import { bindable, type Db } from './db.ts';

export function sqliteDb(path: string): Db {
    const d = new Database(path);
    d.pragma('journal_mode = WAL');
    const b = (params: unknown[]) => params.map(bindable);
    return {
        async get<T>(sql: string, ...params: unknown[]) {
            return d.prepare(sql).get(...b(params)) as T | undefined;
        },
        async all<T>(sql: string, ...params: unknown[]) {
            return d.prepare(sql).all(...b(params)) as T[];
        },
        async run(sql: string, ...params: unknown[]) {
            const info = d.prepare(sql).run(...b(params));
            return { changes: info.changes, lastId: Number(info.lastInsertRowid) };
        },
        async batch(statements) {
            d.transaction(() => {
                for (const [sql, ...params] of statements) d.prepare(sql).run(...b(params));
            })();
        },
    };
}
