// x402 client demo: an agent pays the referee 0.10 AUSD per ruling, gaslessly (ERC-3009).
//   pnpm x402-demo [referee_url]
// Uses a fresh wallet with test AUSD from the Agora faucet; KEEPER_PRIVATE_KEY (from .env) pays the faucet call's gas.
// The agent itself never needs ETH. Prints each step of the 402 flow.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, verifyMessage, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { hashJson } from '../src/types.ts';

const dep = JSON.parse(readFileSync(new URL('../../shared/deployments.json', import.meta.url), 'utf8'));
const base = (process.argv[2] ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, '');
const headers = { 'content-type': 'application/json' };
const body = JSON.stringify({
    goal_text: 'Add a temperature converter CLI with C/F conversion',
    evidence: { type: 'github', repo: 'alaramartin/referee-smoke', shas: process.env.SHAS?.split(',') ?? ['fbf13a991157b10b5f7296ed6ecac0d38d6bb4ba', '0345e08e337103fef125588265aa2d816f4e204b'] },
});
const pub = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL || 'https://sepolia.base.org') });
const bal = (a: `0x${string}`) => pub.readContract({ address: dep.token, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [a] });

const payer = privateKeyToAccount(generatePrivateKey());
console.log(`1. agent wallet ${payer.address}; asking the Agora faucet for AUSD`);
if (!process.env.KEEPER_PRIVATE_KEY) throw new Error('KEEPER_PRIVATE_KEY is required to pay the faucet call gas');
const funder = createWalletClient({ chain: baseSepolia, transport: http(process.env.RPC_URL || 'https://sepolia.base.org'), account: privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY as Hex) });
const faucetTx = await funder.writeContract({
    address: '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C',
    abi: parseAbi(['function requestFunds(address to)']),
    functionName: 'requestFunds',
    args: [payer.address],
});
await pub.waitForTransactionReceipt({ hash: faucetTx });
while ((await bal(payer.address)) === 0n) await new Promise((r) => setTimeout(r, 2000)); // load-balanced RPC lag
console.log(`   balance ${Number(await bal(payer.address)) / 1e6} AUSD, 0 ETH`);

const first = await fetch(`${base}/x402/verify`, { method: 'POST', headers, body });
const req402: any = await first.json();
console.log(`2. POST /x402/verify without payment -> ${first.status}: ${req402.error}`);
const r = req402.accepts[0];
console.log(`   price ${Number(r.maxAmountRequired) / 1e6} AUSD to ${r.payTo} on ${r.network}`);

const auth = {
    from: payer.address,
    to: r.payTo,
    value: BigInt(r.maxAmountRequired),
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + r.maxTimeoutSeconds),
    nonce: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
};
const signature = await payer.signTypedData({
    domain: { name: r.extra.name, version: r.extra.version, chainId: baseSepolia.id, verifyingContract: r.asset },
    types: { TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
    primaryType: 'TransferWithAuthorization',
    message: auth,
});
const payment = Buffer.from(JSON.stringify({
    x402Version: 1, scheme: 'exact', network: r.network,
    payload: { signature, authorization: { ...auth, value: auth.value.toString(), validAfter: '0', validBefore: auth.validBefore.toString() } },
})).toString('base64');
console.log('3. signed an ERC-3009 TransferWithAuthorization (no gas), retrying with X-PAYMENT');

const paid = await fetch(`${base}/x402/verify`, { method: 'POST', headers: { ...headers, 'X-PAYMENT': payment }, body });
const out: any = await paid.json();
if (paid.status !== 200) throw new Error(`paid request failed: ${paid.status} ${JSON.stringify(out)}`);
const receipt = JSON.parse(Buffer.from(paid.headers.get('x-payment-response')!, 'base64').toString());
console.log(`4. ${paid.status}: ruling passed=${out.ruling.passed} — ${out.ruling.reason}`);
console.log(`   votes ${JSON.stringify(out.ruling.model_votes)}`);
console.log(`   payment settled on-chain: ${receipt.transaction} (payer ${receipt.payer})`);
const hashOk = hashJson(out.ruling) === out.evidence_hash;
const sigOk = await verifyMessage({ address: out.attestation.signer, message: { raw: out.evidence_hash }, signature: out.attestation.signature });
console.log(`5. evidence hash recomputes: ${hashOk}; signed by referee ${out.attestation.signer}: ${sigOk}`);
await pub.waitForTransactionReceipt({ hash: receipt.transaction });
while ((await bal(payer.address)) === auth.value * 1000n) await new Promise((r) => setTimeout(r, 2000)); // RPC lag
console.log(`   agent balance now ${Number(await bal(payer.address)) / 1e6} AUSD`);

// Abuse checks: the same payment cannot buy a second ruling, and bad evidence is never charged.
const replay = await fetch(`${base}/x402/verify`, { method: 'POST', headers: { ...headers, 'X-PAYMENT': payment }, body });
console.log(`6. replaying the same X-PAYMENT -> ${replay.status} (${((await replay.json()) as any).error})`);
const before = await bal(payer.address);
const nonce2 = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
const sig2 = await payer.signTypedData({
    domain: { name: r.extra.name, version: r.extra.version, chainId: baseSepolia.id, verifyingContract: r.asset },
    types: { TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
    primaryType: 'TransferWithAuthorization',
    message: { ...auth, nonce: nonce2 },
});
const pay2 = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: r.network,
    payload: { signature: sig2, authorization: { ...auth, nonce: nonce2, value: auth.value.toString(), validAfter: '0', validBefore: auth.validBefore.toString() } } })).toString('base64');
const badEv = await fetch(`${base}/x402/verify`, { method: 'POST', headers: { ...headers, 'X-PAYMENT': pay2 },
    body: JSON.stringify({ goal_text: 'x', evidence: { type: 'github', repo: 'alaramartin/referee-smoke', shas: ['deadbeefdeadbeef'] } }) });
const badOut: any = await badEv.json();
await new Promise((r) => setTimeout(r, 4000));
console.log(`7. valid payment + bad evidence -> ${badEv.status} (${badOut.error}, charged=${badOut.charged}); balance unchanged: ${(await bal(payer.address)) === before}`);
