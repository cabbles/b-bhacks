// Self-test: ERC-3009 signatures from lib/erc3009.ts recover to the staker. Run: pnpm test:sig
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, serializeSignature } from "viem";
import { RECEIVE_WITH_AUTHORIZATION_TYPES, signStakeAuthorization } from "../lib/erc3009";

async function main() {
  const acct = privateKeyToAccount(generatePrivateKey());
  const cfg: Parameters<typeof signStakeAuthorization>[1] = {
    chainId: 84532,
    pool: "0x000000000000000000000000000000000000dEaD",
    token: "0x000000000000000000000000000000000000bEEF",
    tokenDomain: { name: "AUSD", version: "1" },
  };
  const value = 10_000_000n;

  for (let i = 0; i < 20; i++) {
    const a = await signStakeAuthorization(acct, cfg, value);
    const signature = serializeSignature({ r: a.r, s: a.s, v: BigInt(a.v) });
    const recovered = await recoverTypedDataAddress({
      domain: { ...cfg.tokenDomain, chainId: cfg.chainId, verifyingContract: cfg.token },
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: acct.address,
        to: cfg.pool,
        value,
        validAfter: BigInt(a.validAfter),
        validBefore: BigInt(a.validBefore),
        nonce: a.nonce,
      },
      signature,
    });
    if (recovered !== acct.address || ![27, 28].includes(a.v) || a.r.length !== 66 || a.s.length !== 66) {
      console.error("FAIL", a, recovered);
      process.exit(1);
    }
  }
  console.log("OK 20/20 signatures recover to staker, v in {27,28}");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
