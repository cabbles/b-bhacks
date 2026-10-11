// x402: the referee's verification API for third-party apps, paid per request in AUSD.
// HTTP 402 Payment Required + an ERC-3009 TransferWithAuthorization in the X-PAYMENT header
// ("exact" scheme). Groups never pay this; it is how the referee would fund itself without
// taking a cut of anyone's pot.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getAddress, isAddress, verifyTypedData, type Hex } from 'viem';
import { config, signerReady } from './config.ts';
import { settlePayment, signAttestation, simulatePayment, type Authorization } from './chain.ts';
import { commitDetail, isWhitespaceOnly, repoInfo } from './collectors/github.ts';
import { fetchText, visibleText } from './collectors/url.ts';
import { judgeEvidence } from './engine.ts';
import { hashJson } from './types.ts';

const NETWORK = config.chainId === 84532 ? 'base-sepolia' : `eip155:${config.chainId}`;
const PRICE = BigInt(process.env.X402_PRICE ?? 100_000); // 0.10 AUSD (6 decimals)
const TOKEN_NAME = process.env.X402_TOKEN_NAME ?? 'Agora Dollar';
const TOKEN_VERSION = process.env.X402_TOKEN_VERSION ?? '1';
const MAX_TIMEOUT = 300;

const token = () => (process.env.X402_ASSET || config.token) as Hex;
const payTo = () => (process.env.X402_PAY_TO || config.refereeAddress) as Hex;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');

function resourceUrl(req: FastifyRequest, path: string) {
    // Behind the ngrok tunnel the public scheme and host arrive in forwarded headers.
    const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0];
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? req.hostname).split(',')[0];
    return `${proto}://${host}${path}`;
}

function requirements(req: FastifyRequest) {
    return {
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired: PRICE.toString(),
        resource: resourceUrl(req, '/x402/verify'),
        description: 'AI referee ruling: does this evidence plausibly deliver the stated goal? Two independent models, injection-hardened, signed result.',
        mimeType: 'application/json',
        payTo: payTo(),
        maxTimeoutSeconds: MAX_TIMEOUT,
        asset: token(),
        extra: { name: TOKEN_NAME, version: TOKEN_VERSION },
    };
}

const paymentRequired = (req: FastifyRequest, reply: FastifyReply, error: string) =>
    reply.code(402).send({ x402Version: 1, error, accepts: [requirements(req)] });

const TRANSFER_TYPES = {
    TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
    ],
} as const;

/** Decode and check an X-PAYMENT header. Returns the authorization or a reason it is not acceptable. */
async function checkPayment(header: string): Promise<{ auth: Authorization; signature: Hex } | string> {
    let p: any;
    try {
        p = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    } catch {
        return 'X-PAYMENT is not base64 JSON';
    }
    if (p?.x402Version !== 1 || p.scheme !== 'exact' || p.network !== NETWORK) return 'unsupported x402 version, scheme or network';
    const a = p.payload?.authorization;
    const signature = p.payload?.signature as Hex;
    if (!a || !/^0x[0-9a-fA-F]+$/.test(signature ?? '') || ![a.from, a.to].every((x) => isAddress(x ?? ''))) return 'malformed payment payload';
    const auth: Authorization = {
        from: getAddress(a.from),
        to: getAddress(a.to),
        value: BigInt(a.value),
        validAfter: BigInt(a.validAfter),
        validBefore: BigInt(a.validBefore),
        nonce: a.nonce,
    };
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (auth.to !== getAddress(payTo())) return 'payment must be made to payTo';
    if (auth.value < PRICE) return `payment below price (${PRICE} base units)`;
    if (auth.validAfter > now || auth.validBefore < now + 30n) return 'authorization not currently valid';
    const ok = await verifyTypedData({
        address: auth.from,
        domain: { name: TOKEN_NAME, version: TOKEN_VERSION, chainId: config.chainId, verifyingContract: token() },
        types: TRANSFER_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: auth,
        signature,
    }).catch(() => false);
    if (!ok) return 'invalid payment signature';
    // Dry run: balance, unused nonce, token accepts it. Retry once, because the public RPC is
    // load-balanced and a node a few blocks behind may not see funds the payer just received.
    for (let attempt = 0; ; attempt++) {
        try {
            await simulatePayment(token(), auth, signature);
            break;
        } catch (err) {
            if (attempt === 0) {
                await new Promise((r) => setTimeout(r, 3000));
                continue;
            }
            return `payment would fail: ${(err as any).shortMessage ?? (err as Error).message}`.slice(0, 200);
        }
    }
    return { auth, signature };
}

/** Gather evidence the referee fetches itself; nothing is taken from the caller but pointers. */
async function gather(e: any): Promise<{ evidence: unknown } | string> {
    if (e?.type === 'url') {
        if (typeof e.url !== 'string' || !e.url.startsWith('https://')) return 'evidence.url must be an https URL';
        const page = await fetchText(e.url);
        if (!page.ok) return `could not fetch ${e.url}: ${page.error ?? `HTTP ${page.status}`}`;
        const text = visibleText(page.text);
        const evidence: Record<string, unknown> = { url: page.final_url ?? e.url, visible_text: text.slice(0, 20_000), html: page.text.slice(0, 30_000) };
        if (typeof e.must_contain === 'string') evidence.contains_promised_text = text.toLowerCase().includes(e.must_contain.toLowerCase());
        return { evidence };
    }
    if (e?.type === 'github') {
        if (typeof e.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(e.repo)) return 'evidence.repo must be owner/name';
        const shas: string[] = Array.isArray(e.shas) ? e.shas.filter((s: unknown) => typeof s === 'string' && /^[0-9a-f]{7,40}$/i.test(s)) : [];
        if (!shas.length || shas.length > 10) return 'evidence.shas must list 1-10 commit SHAs';
        const info = await repoInfo(e.repo);
        if (!info.exists || info.private) return `repo ${e.repo} not found or private`;
        const details = await Promise.all(shas.map((s) => commitDetail(e.repo, s).catch(() => null)));
        if (details.some((d) => !d)) return 'one or more commits not found in the repo';
        if (details.every((d) => isWhitespaceOnly(d!))) return { evidence: { repo: e.repo, whitespace_only: true } };
        return {
            evidence: {
                repo: e.repo,
                commits: details.map((d) => ({
                    sha: d!.sha.slice(0, 10),
                    message: d!.message.slice(0, 500),
                    files: d!.files.map((f) => ({ file: f.filename, additions: f.additions, deletions: f.deletions, patch: (f.patch ?? '').slice(0, 6000) })),
                })),
            },
        };
    }
    return 'evidence.type must be "url" or "github"';
}

export async function x402Routes(app: FastifyInstance) {
    app.post('/x402/verify', async (req, reply) => {
        if (!signerReady() || !token()) return reply.code(503).send({ error: 'payments not configured' });
        const b = (req.body ?? {}) as any;
        if (typeof b.goal_text !== 'string' || !b.goal_text.trim() || b.goal_text.length > 2000)
            return reply.code(400).send({ error: 'goal_text required (1-2000 chars)' });

        const header = req.headers['x-payment'];
        if (typeof header !== 'string') return paymentRequired(req, reply, 'X-PAYMENT header is required');
        const pay = await checkPayment(header);
        if (typeof pay === 'string') return paymentRequired(req, reply, pay);

        // Do the work first; only settle (take the money) if the ruling is delivered.
        const g = await gather(b.evidence);
        if (typeof g === 'string') return reply.code(400).send({ error: g, charged: false });
        const whitespace = (g.evidence as any).whitespace_only === true;
        const s = whitespace
            ? { check: { name: 'substance', passed: false, detail: 'Every commit changes whitespace only.' }, votes: [], split: false }
            : await judgeEvidence(b.goal_text, g.evidence);
        if (!s.check) return reply.code(503).send({ error: 'model judges not configured', charged: false });

        const ruling = {
            version: 1,
            goal_text: b.goal_text,
            evidence_pointer: b.evidence,
            passed: s.check.passed,
            needs_human: s.split,
            reason: s.check.detail,
            model_votes: s.votes,
            decided_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        };
        const evidenceHash = hashJson(ruling);
        let tx: Hex;
        try {
            tx = await settlePayment(token(), pay.auth, pay.signature);
        } catch (err) {
            return paymentRequired(req, reply, `settlement failed: ${(err as Error).message.slice(0, 160)}`);
        }
        const attestation = await signAttestation(evidenceHash);
        reply.header('X-PAYMENT-RESPONSE', b64({ success: true, transaction: tx, network: NETWORK, payer: pay.auth.from }));
        return { ruling, evidence_hash: evidenceHash, attestation, payment: { transaction: tx, payer: pay.auth.from, amount: pay.auth.value.toString() } };
    });

    // Free, machine-readable price list for agents discovering the API.
    app.get('/x402', async (req) => ({ x402Version: 1, endpoints: { 'POST /x402/verify': requirements(req) } }));
}
