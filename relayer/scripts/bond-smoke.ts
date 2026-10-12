// Live check of the owner's bond path: create market -> drip -> stake -> bond -> read.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAbiParameters, keccak256, parseSignature, stringToHex, toHex, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const dep = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../shared/deployments.json'), 'utf8'));
const R = (process.env.RELAYER ?? dep.relayer_url).replace(/\/$/, '');
const MARKET_TAG = keccak256(stringToHex('cashcow:group'));
const call = async (p: string, b?: unknown) => {
    const r = await fetch(R + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    const j: any = await r.json();
    console.log(r.status, p, JSON.stringify(j).slice(0, 160));
    if (!r.ok) throw new Error(p);
    return j;
};
const types = { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] } as const;
const cfg = await call('/config');
const m = await call('/groups', { stake: 1, stake_minutes: 5, goal_minutes: 5, rule_hash: MARKET_TAG });
const id = BigInt(m.group_id);
const user = privateKeyToAccount(generatePrivateKey());
await call('/drip', { address: user.address });
await new Promise((r) => setTimeout(r, 4000));
const sign = async (to: Address, value: bigint, nonce: `0x${string}`) => {
    const s = parseSignature(await user.signTypedData({ domain: { ...cfg.tokenDomain, chainId: cfg.chainId, verifyingContract: cfg.token }, types, primaryType: 'ReceiveWithAuthorization', message: { from: user.address, to, value, validAfter: 0n, validBefore: BigInt(Math.floor(Date.now() / 1000) + 600), nonce } }));
    return { validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce, v: Number(s.v), r: s.r, s: s.s };
};
const goal = keccak256(toHex('bond smoke ' + Date.now()));
const stakeNonce = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [id, goal]));
await call('/stake', { cohort_id: Number(id), staker: user.address, goal_hash: goal, authorization: await sign(cfg.pool, 1_000_000n, stakeNonce) });
await new Promise((r) => setTimeout(r, 4000));
const amount = 5_000_000n;
const bondNonce = keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }], ['cashcow:bond', id, user.address, amount]));
await call('/bond', { cohort_id: Number(id), owner: user.address, amount: amount.toString(), authorization: await sign(cfg.bond_pool, amount, bondNonce) });
await new Promise((r) => setTimeout(r, 4000));
await call(`/bonds/${id}/${user.address}`);
