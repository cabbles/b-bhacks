import { encodeAbiParameters, keccak256, parseSignature } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
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
  account: PrivateKeyAccount,
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
