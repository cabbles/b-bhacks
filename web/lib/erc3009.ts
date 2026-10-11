import { encodeAbiParameters, keccak256, parseSignature } from "viem";
import type { Authorization, RelayerConfig } from "./types";

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// Only the ERC-3009 signing capability is required, compatible across workspace viem versions.
type AuthorizationSigner = {
  address: `0x${string}`;
  signTypedData: (parameters: {
    domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
    types: typeof RECEIVE_WITH_AUTHORIZATION_TYPES;
    primaryType: "ReceiveWithAuthorization";
    message: { from: `0x${string}`; to: `0x${string}`; value: bigint; validAfter: bigint; validBefore: bigint; nonce: `0x${string}` };
  }) => Promise<`0x${string}`>;
};

/**
 * The ERC-3009 nonce the pool requires: StakePool.authNonce = keccak256(abi.encode(cohortId, goalHash)).
 * Binds the signature to one cohort and one goal; any other nonce reverts with BadNonce.
 */
export function authNonce(cohortId: number | bigint, goalHash: `0x${string}`): `0x${string}` {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [BigInt(cohortId), goalHash]));
}

/**
 * Sign ReceiveWithAuthorization. `to` is the pool: the pool calls
 * token.receiveWithAuthorization, so only the pool can redeem this signature.
 */
export async function signStakeAuthorization(
  account: AuthorizationSigner,
  cfg: Pick<RelayerConfig, "chainId" | "pool" | "token" | "tokenDomain">,
  stake: { cohortId: number; goalHash: `0x${string}`; value: bigint },
  ttlSeconds = 3600,
): Promise<Authorization> {
  const nonce = authNonce(stake.cohortId, stake.goalHash);
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + ttlSeconds);
  const sig = await account.signTypedData({
    domain: {
      name: cfg.tokenDomain.name,
      version: cfg.tokenDomain.version,
      chainId: cfg.chainId,
      verifyingContract: cfg.token,
    },
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: cfg.pool, value: stake.value, validAfter, validBefore, nonce },
  });
  const { r, s, v, yParity } = parseSignature(sig);
  return {
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
    v: v !== undefined ? Number(v) : yParity + 27,
    r,
    s,
  };
}

/** MarketPool nonce includes side/amount and a per-wallet sequence to allow repeat bets safely. */
export function betAuthNonce(cohortId: number | bigint, owner: `0x${string}`, bettor: `0x${string}`, yes: boolean, amount: bigint, sequence: bigint) {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
    [BigInt(cohortId), owner, bettor, yes, amount, sequence],
  ));
}

export async function signBetAuthorization(
  account: AuthorizationSigner,
  cfg: Pick<RelayerConfig, "chainId" | "token" | "tokenDomain">,
  bet: { pool: `0x${string}`; cohortId: number; owner: `0x${string}`; yes: boolean; value: bigint; sequence: bigint; deadline: number },
): Promise<Authorization> {
  const validAfter = 0n;
  const validBefore = BigInt(Math.min(Math.floor(Date.now() / 1000) + 600, bet.deadline));
  const nonce = betAuthNonce(bet.cohortId, bet.owner, account.address, bet.yes, bet.value, bet.sequence);
  const sig = await account.signTypedData({
    domain: { ...cfg.tokenDomain, chainId: cfg.chainId, verifyingContract: cfg.token },
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: bet.pool, value: bet.value, validAfter, validBefore, nonce },
  });
  const { r, s, v, yParity } = parseSignature(sig);
  return { validAfter: "0", validBefore: String(validBefore), nonce, v: v !== undefined ? Number(v) : yParity + 27, r, s };
}

/** CommitmentBond nonce: keccak256(abi.encode("cashcow:bond", cohortId, owner, amount)). One bond per task. */
export function bondAuthNonce(cohortId: number | bigint, owner: `0x${string}`, amount: bigint) {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
    ["cashcow:bond", BigInt(cohortId), owner, amount],
  ));
}

/** The task owner's separate stake (bond) for a prediction market: back on pass, to NO bettors (or burned) on fail. */
export async function signBondAuthorization(
  account: AuthorizationSigner,
  cfg: Pick<RelayerConfig, "chainId" | "token" | "tokenDomain">,
  bond: { pool: `0x${string}`; cohortId: number; value: bigint },
): Promise<Authorization> {
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const nonce = bondAuthNonce(bond.cohortId, account.address, bond.value);
  const sig = await account.signTypedData({
    domain: { ...cfg.tokenDomain, chainId: cfg.chainId, verifyingContract: cfg.token },
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: bond.pool, value: bond.value, validAfter: 0n, validBefore, nonce },
  });
  const { r, s, v, yParity } = parseSignature(sig);
  return { validAfter: "0", validBefore: String(validBefore), nonce, v: v !== undefined ? Number(v) : yParity + 27, r, s };
}
