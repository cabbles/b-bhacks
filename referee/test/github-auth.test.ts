import { test } from 'node:test';
import assert from 'node:assert/strict';

// config.ts reads env at import time.
process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client';
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-secret';
process.env.TOKEN_ENC_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const { setDb, ensureSchema, db } = await import('../src/db.ts');
const { sqliteDb } = await import('../src/db-sqlite.ts');
const { canPush, decryptToken, encryptToken, githubAuthReady, linkMessage } = await import('../src/github-auth.ts');

setDb(sqliteDb(':memory:'));
await ensureSchema();

const WALLET = '0x000000000000000000000000000000000000dEaD';
const realFetch = globalThis.fetch;
function fakeGithub(status: number, body: object) {
    const calls: { url: string; auth: string | null }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
        return Response.json(body, { status });
    }) as typeof fetch;
    return calls;
}

test('github-auth: configured from env', () => {
    assert.equal(githubAuthReady(), true);
});

test('github-auth: token encryption round-trips and is not the plain token', async () => {
    const blob = await encryptToken('gho_secret');
    assert.ok(!blob.includes('gho_secret'));
    assert.notEqual(blob, await encryptToken('gho_secret'), 'fresh IV each time');
    assert.equal(await decryptToken(blob), 'gho_secret');
});

test('github-auth: link message names the action, the checksummed wallet and the time', () => {
    const m = linkMessage('connect', WALLET.toLowerCase(), '2026-10-18T00:00:00Z');
    assert.match(m, /connect GitHub to wallet 0x000000000000000000000000000000000000dEaD/);
    assert.match(m, /Issued at: 2026-10-18T00:00:00Z/);
});

test('github-auth: no connected account means no staking', async () => {
    const r = await canPush(WALLET, 'alice/repo');
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /Connect your GitHub/);
});

test('github-auth: push access decides, asked with the staker’s own token', async () => {
    await db().run(
        'INSERT INTO github_links (wallet, github_id, login, token_enc, linked_at) VALUES (?, ?, ?, ?, ?)',
        WALLET.toLowerCase(), 1, 'alice', await encryptToken('gho_alice'), 'now',
    );

    let calls = fakeGithub(200, { private: false, permissions: { push: true } });
    assert.deepEqual(await canPush(WALLET, 'bob/shared'), { ok: true, login: 'alice' });
    assert.match(calls[0].url, /\/repos\/bob\/shared$/);
    assert.equal(calls[0].auth, 'Bearer gho_alice');

    fakeGithub(200, { private: false, permissions: { push: false } });
    assert.match(((await canPush(WALLET, 'torvalds/linux')) as { reason: string }).reason, /can't push to torvalds\/linux/);

    fakeGithub(200, { private: true, permissions: { push: true } });
    assert.match(((await canPush(WALLET, 'alice/secret')) as { reason: string }).reason, /private/);

    fakeGithub(404, { message: 'Not Found' });
    assert.match(((await canPush(WALLET, 'alice/nope')) as { reason: string }).reason, /not found/);

    fakeGithub(401, { message: 'Bad credentials' });
    assert.match(((await canPush(WALLET, 'alice/repo')) as { reason: string }).reason, /expired or was revoked/);

    globalThis.fetch = realFetch;
});

test('github-auth: an expired token is renewed with the refresh token, then the check goes through', async () => {
    await db().run('UPDATE github_links SET refresh_enc = ? WHERE wallet = ?', await encryptToken('ghr_refresh'), WALLET.toLowerCase());
    const seen: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get('authorization');
        seen.push(`${url} ${auth ?? JSON.parse(String(init?.body ?? '{}')).grant_type}`);
        if (String(url).includes('/login/oauth/access_token')) return Response.json({ access_token: 'gho_new', refresh_token: 'ghr_new' });
        if (auth === 'Bearer gho_alice') return Response.json({ message: 'Bad credentials' }, { status: 401 });
        return Response.json({ private: false, permissions: { push: true } });
    }) as typeof fetch;
    assert.deepEqual(await canPush(WALLET, 'alice/repo'), { ok: true, login: 'alice' });
    assert.equal(seen.length, 3, seen.join(' | '));
    assert.match(seen[2], /Bearer gho_new$/);
    // The renewed tokens were stored, encrypted.
    const row = (await db().get<{ token_enc: string; refresh_enc: string }>('SELECT token_enc, refresh_enc FROM github_links WHERE wallet = ?', WALLET.toLowerCase()))!;
    assert.equal(await decryptToken(row.token_enc), 'gho_new');
    assert.equal(await decryptToken(row.refresh_enc), 'ghr_new');
    globalThis.fetch = realFetch;
});
