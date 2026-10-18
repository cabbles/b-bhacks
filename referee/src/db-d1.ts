// Cloudflare backend: D1 behind the async Db interface.
import type { D1Database } from '@cloudflare/workers-types';
import { bindable, type Db } from './db.ts';

export function d1Db(binding: D1Database): Db {
    const prep = (sql: string, params: unknown[]) => binding.prepare(sql).bind(...params.map(bindable));
    return {
        async get<T>(sql: string, ...params: unknown[]) {
            return ((await prep(sql, params).first<T>()) ?? undefined) as T | undefined;
        },
        async all<T>(sql: string, ...params: unknown[]) {
            return (await prep(sql, params).all<T>()).results;
        },
        async run(sql: string, ...params: unknown[]) {
            const r = await prep(sql, params).run();
            return { changes: r.meta.changes ?? 0, lastId: r.meta.last_row_id ?? 0 };
        },
        async batch(statements) {
            if (statements.length) await binding.batch(statements.map(([sql, ...params]) => prep(sql, params)));
        },
    };
}
