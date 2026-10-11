import { bytesToHex, parseSignature } from "viem";
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
 * Sign ReceiveWithAuthorization. `to` is the pool: the pool calls
 * token.receiveWithAuthorization, so only the pool can redeem this signature.
 */
export async function signStakeAuthorization(
  account: PrivateKeyAccount,
  cfg: Pick<RelayerConfig, "chainId" | "pool" | "token" | "tokenDomain">,
  value: bigint,
  ttlSeconds = 3600,
): Promise<Authorization> {
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
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
    message: { from: account.address, to: cfg.pool, value, validAfter, validBefore, nonce },
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
