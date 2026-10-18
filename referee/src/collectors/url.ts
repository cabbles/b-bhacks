import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 512 * 1024;

function privateAddress(ip: string): boolean {
    if (isIP(ip) === 6) {
        const v = ip.toLowerCase();
        if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
        return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
    }
    const [a, b] = ip.split('.').map(Number);
    return (
        a === 10 || a === 127 || a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        a >= 224
    );
}

async function assertPublic(url: URL) {
    if (url.protocol !== 'https:') throw new Error('only https is fetched');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && privateAddress(host))) throw new Error('host is a private address');
    let addrs: { address: string }[];
    try {
        addrs = await lookup(host, { all: true });
    } catch (err) {
        // Workers has no general DNS lookup, but its fetch can only reach the public internet anyway.
        if (/not implemented|unsupported|ENOTSUP/i.test(String((err as Error)?.message ?? err))) return;
        throw err;
    }
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error('host resolves to a private address');
}

export type Fetched = { ok: boolean; status: number; text: string; error?: string; final_url?: string };

/** Fetch a public https URL as plain text. Follows up to 3 redirects, re-checking each host. Never throws. */
export async function fetchText(raw: string): Promise<Fetched> {
    try {
        let url = new URL(raw);
        for (let hop = 0; hop < 4; hop++) {
            await assertPublic(url);
            const r = await fetch(url, {
                redirect: 'manual',
                headers: { 'User-Agent': 'ai-referee/1 (+hackathon)', 'Cache-Control': 'no-cache' },
                signal: AbortSignal.timeout(15_000),
            });
            if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
                url = new URL(r.headers.get('location')!, url);
                continue;
            }
            const reader = r.body?.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                size += value.length;
                if (size >= MAX_BYTES) {
                    await reader.cancel();
                    break;
                }
            }
            const text = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
            return { ok: r.ok, status: r.status, text, final_url: url.toString() };
        }
        return { ok: false, status: 0, text: '', error: 'too many redirects' };
    } catch (err) {
        return { ok: false, status: 0, text: '', error: (err as Error).message };
    }
}

/** Visible text approximation: drop scripts, styles, comments and tags, collapse whitespace. */
export function visibleText(html: string): string {
    return html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

export const wellKnownUrl = (raw: string) => new URL('/.well-known/referee.txt', raw).toString();
