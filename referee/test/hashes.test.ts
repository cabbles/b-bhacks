import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hashJson } from '../src/types.ts';

// goalHash / evidenceHash must equal the reference values in shared/fixtures/hashes.json.
const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../shared/fixtures/${n}.json`, import.meta.url), 'utf8'));
const hashes = fx('hashes');

for (const t of ['github_commits', 'url_live', 'canvas_submission']) {
    test(`goal_hash ${t}`, () => assert.equal(hashJson(fx(`criteria.${t}`)), hashes.goal_hash[t]));
    test(`evidence_hash ${t}`, () => assert.equal(hashJson(fx(`verdict.${t}`)), hashes.evidence_hash[t]));
}
