// "Connect GitHub": links a wallet to a GitHub account with GitHub's own sign-in (OAuth, no scopes), so the referee
// can check that a staker can push to the repo their task is about. This replaces the old nonce-file proof.
//
// Flow: the wallet signs a message -> POST /auth/github/start returns GitHub's authorize URL -> GitHub redirects to
// /auth/github/callback -> the referee stores the GitHub login and the (scope-less) token, AES-GCM encrypted.
import type { Context, Hono } from 'hono';
import { getAddress, isAddress, type Hex } from 'viem';
import { publicClient } from './chain.ts';
import { config } from './config.ts';
import { db, nowIso } from './db.ts';

const LINK_MAX_AGE_MS = 10 * 60_000;
const STATE_TTL_MS = 10 * 60_000;
const GH_API = 'https://api.github.com';

export const githubAuthReady = () => Boolean(config.githubClientId && config.githubClientSecret && config.tokenKey);

/** The exact text a wallet signs to connect or disconnect GitHub. Shown in the wallet, so keep it readable. */
export const linkMessage = (action: 'connect' | 'disconnect', wallet: string, issuedAt: string) =>
    `Cash Cow: ${action} GitHub ${action === 'connect' ? 'to' : 'from'} wallet ${getAddress(wallet)}\nIssued at: ${issuedAt}`;

/* ------------------------------------------------------------ token encryption */

let keyPromise: Promise<CryptoKey> | null = null;
function key() {
    keyPromise ??= crypto.subtle.importKey('raw', b64decode(config.tokenKey), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return keyPromise;
}
const b64encode = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const b64decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptToken(token: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(token)));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv);
    out.set(ct, iv.length);
    return b64encode(out);
}

export async function decryptToken(blob: string): Promise<string> {
    const raw = b64decode(blob);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await key(), raw.slice(12));
    return new TextDecoder().decode(pt);
}

/* ------------------------------------------------------------ links */

type LinkRow = { wallet: string; github_id: number; login: string; token_enc: string; refresh_enc: string | null; linked_at: string };

export async function githubLink(wallet: string): Promise<LinkRow | undefined> {
    return db().get<LinkRow>('SELECT * FROM github_links WHERE wallet = ?', wallet.toLowerCase());
}

export type PushCheck = { ok: true; login: string } | { ok: false; reason: string };

type TokenResponse = { access_token?: string; refresh_token?: string };

/** GitHub's OAuth token endpoint: exchange a sign-in code, or renew an expired token (tokens last 8 hours). */
async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: config.githubClientId, client_secret: config.githubClientSecret, ...params }),
    });
    return (await res.json().catch(() => ({}))) as TokenResponse;
}

/** Renew the stored token with its refresh token; returns the new access token, or null if the link is no longer valid. */
async function refresh(link: LinkRow): Promise<string | null> {
    if (!link.refresh_enc) return null;
    const refreshToken = await decryptToken(link.refresh_enc).catch(() => null);
    if (!refreshToken) return null;
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (!t.access_token) return null;
    await db().run(
        'UPDATE github_links SET token_enc = ?, refresh_enc = ? WHERE wallet = ?',
        await encryptToken(t.access_token), t.refresh_token ? await encryptToken(t.refresh_token) : link.refresh_enc, link.wallet,
    );
    return t.access_token;
}

const repoAs = (repo: string, token: string) =>
    fetch(`${GH_API}/repos/${repo}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cashcow-referee' },
    });

/** Can this wallet's connected GitHub account push to owner/name? Asked as that account, so collaborators count. */
export async function canPush(wallet: string, repo: string): Promise<PushCheck> {
    if (!githubAuthReady()) return { ok: false, reason: 'GitHub sign-in is not set up on this referee yet.' };
    const link = await githubLink(wallet);
    if (!link) return { ok: false, reason: 'Connect your GitHub account first, so the referee can check the repo is yours.' };
    let token: string;
    try {
        token = await decryptToken(link.token_enc);
    } catch {
        return { ok: false, reason: 'Your GitHub connection could not be read. Connect GitHub again.' };
    }
    let res = await repoAs(repo, token);
    if (res.status === 401) {
        const renewed = await refresh(link);
        if (!renewed) return { ok: false, reason: 'Your GitHub connection expired or was revoked. Connect GitHub again.' };
        res = await repoAs(repo, renewed);
        if (res.status === 401) return { ok: false, reason: 'Your GitHub connection expired or was revoked. Connect GitHub again.' };
    }
    if (res.status === 404) return { ok: false, reason: `Repo ${repo} was not found. It must exist and be public.` };
    if (!res.ok) throw new Error(`GitHub ${res.status} checking ${repo}`);
    const r = (await res.json()) as { private?: boolean; permissions?: { push?: boolean } };
    if (r.private) return { ok: false, reason: `Repo ${repo} is private. The referee can only judge public repos.` };
    if (!r.permissions?.push) return { ok: false, reason: `@${link.login} can't push to ${repo}. You can only stake on repos you can push to.` };
    return { ok: true, login: link.login };
}

/* ------------------------------------------------------------ routes */

async function verifyWalletSignature(action: 'connect' | 'disconnect', b: any): Promise<string | null> {
    if (!isAddress(b?.wallet ?? '') || typeof b?.signature !== 'string' || typeof b?.issued_at !== 'string') return null;
    const issued = Date.parse(b.issued_at);
    if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > LINK_MAX_AGE_MS) return null;
    // publicClient.verifyMessage also accepts smart-account signatures (ERC-1271 / ERC-6492).
    const ok = await publicClient
        .verifyMessage({ address: b.wallet, message: linkMessage(action, b.wallet, b.issued_at), signature: b.signature as Hex })
        .catch(() => false);
    return ok ? (b.wallet as string).toLowerCase() : null;
}

function callbackUrl(c: Context) {
    const u = new URL(c.req.url);
    return `${u.protocol}//${u.host}/auth/github/callback`;
}

// Only a path on our own site, so the sign-in can't be used to bounce people to another domain.
const safePath = (p: unknown) => (typeof p === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(p) && !p.startsWith('//') ? p : '/stake');
const backToSite = (c: Context, path: string, result: string) =>
    c.redirect(`${config.webUrl || ''}${safePath(path)}?github=${encodeURIComponent(result)}`, 302);

export function githubAuthRoutes(app: Hono) {
    app.get('/auth/github/status', async (c) => {
        const wallet = c.req.query('wallet') ?? '';
        if (!isAddress(wallet)) return c.json({ error: 'wallet required' }, 400);
        const link = await githubLink(wallet);
        return c.json({ configured: githubAuthReady(), linked: Boolean(link), login: link?.login ?? null });
    });

    app.post('/auth/github/start', async (c) => {
        if (!githubAuthReady()) return c.json({ error: 'GitHub sign-in is not set up on this referee yet.' }, 503);
        const body = await c.req.json().catch(() => ({}));
        const wallet = await verifyWalletSignature('connect', body);
        if (!wallet) return c.json({ error: 'Wallet signature missing, invalid or more than 10 minutes old.' }, 401);
        const state = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');
        await db().run('DELETE FROM oauth_states WHERE expires_ms < ?', Date.now());
        await db().run(
            'INSERT INTO oauth_states (state, wallet, return_path, expires_ms) VALUES (?, ?, ?, ?)',
            state, wallet, safePath(body.return_path), Date.now() + STATE_TTL_MS,
        );
        const url = new URL('https://github.com/login/oauth/authorize');
        url.searchParams.set('client_id', config.githubClientId);
        url.searchParams.set('redirect_uri', callbackUrl(c));
        url.searchParams.set('state', state);
        url.searchParams.set('allow_signup', 'false');
        // No scope: public profile only. That is enough to see push permission on public repos.
        url.searchParams.set('scope', '');
        return c.json({ url: url.toString() });
    });

    app.get('/auth/github/callback', async (c) => {
        const code = c.req.query('code');
        const state = c.req.query('state');
        if (!state) return backToSite(c, '/stake', 'cancelled');
        const row = await db().get<{ wallet: string; return_path: string; expires_ms: number }>(
            'SELECT wallet, return_path, expires_ms FROM oauth_states WHERE state = ?',
            state,
        );
        await db().run('DELETE FROM oauth_states WHERE state = ?', state);
        if (!row || row.expires_ms < Date.now()) return backToSite(c, '/stake', 'expired');
        if (!code) return backToSite(c, row.return_path, 'cancelled');

        const tok = await tokenRequest({ code, redirect_uri: callbackUrl(c) });
        if (!tok.access_token) return backToSite(c, row.return_path, 'failed');
        const userRes = await fetch(`${GH_API}/user`, {
            headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cashcow-referee' },
        });
        if (!userRes.ok) return backToSite(c, row.return_path, 'failed');
        const user = (await userRes.json()) as { id: number; login: string };
        await db().run(
            `INSERT INTO github_links (wallet, github_id, login, token_enc, refresh_enc, linked_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(wallet) DO UPDATE SET github_id = excluded.github_id, login = excluded.login, token_enc = excluded.token_enc,
                refresh_enc = excluded.refresh_enc, linked_at = excluded.linked_at`,
            row.wallet, user.id, user.login, await encryptToken(tok.access_token),
            tok.refresh_token ? await encryptToken(tok.refresh_token) : null, nowIso(),
        );
        return backToSite(c, row.return_path, 'connected');
    });

    app.post('/auth/github/disconnect', async (c) => {
        const wallet = await verifyWalletSignature('disconnect', await c.req.json().catch(() => ({})));
        if (!wallet) return c.json({ error: 'Wallet signature missing, invalid or more than 10 minutes old.' }, 401);
        const link = await githubLink(wallet);
        if (link && githubAuthReady()) {
            // Revoke the token at GitHub too (best effort), so it is useless even if a copy existed somewhere.
            const token = await decryptToken(link.token_enc).catch(() => null);
            if (token)
                await fetch(`${GH_API}/applications/${config.githubClientId}/token`, {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Basic ${btoa(`${config.githubClientId}:${config.githubClientSecret}`)}`,
                        Accept: 'application/vnd.github+json',
                        'User-Agent': 'cashcow-referee',
                    },
                    body: JSON.stringify({ access_token: token }),
                }).catch(() => {});
        }
        await db().run('DELETE FROM github_links WHERE wallet = ?', wallet);
        return c.json({ linked: false });
    });
}
