// PLAN.md 4.4. The one canonical JSON function. Import it; do not re-implement it.
// Keys sorted recursively (by UTF-16 code unit, i.e. Array.prototype.sort default), no whitespace.
// Object entries whose value is undefined are dropped, as JSON.stringify does.
// The caller UTF-8 encodes the result before hashing:
//   goalHash     = keccak256(toBytes(canonical(criteria)))
//   evidenceHash = keccak256(toBytes(canonical(verdict)))
export function canonical(obj: unknown): string {
    return JSON.stringify(sortKeys(obj));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value !== null && typeof value === 'object') {
        const src = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(src).sort()) {
            if (src[key] !== undefined) out[key] = sortKeys(src[key]);
        }
        return out;
    }
    return value;
}
