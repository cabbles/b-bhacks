import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWhitespaceOnly } from '../src/collectors/github.ts';

const commit = (patch: string) => ({ sha: 'x', message: '', parents: 1, files: [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 1, patch }] });

test('whitespace-only commit is filler', () => {
    assert.equal(isWhitespaceOnly(commit('@@ -1 +1 @@\n-const a = 1;\n+const  a =  1;\n+\n')), true);
});

test('real change is not filler', () => {
    assert.equal(isWhitespaceOnly(commit('@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n')), false);
});
