// Self-test for stake signing and hashing. Run: pnpm test:sig
// 1. ERC-3009 ReceiveWithAuthorization signatures recover to the staker.
// 2. The nonce equals StakePool.authNonce = keccak256(abi.encode(cohortId, goalHash)).
// 3. goal/evidence hashes from shared/canonical match shared/fixtures/hashes.json.
import { readFileSync } from "fs";
import { join } from "path";
import { concat, keccak256, pad, recoverTypedDataAddress, serializeSignature, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { authNonce, RECEIVE_WITH_AUTHORIZATION_TYPES, signStakeAuthorization } from "../lib/erc3009";
import { evidenceHashOf, goalHashOf } from "../lib/hashes";

const fixtures = join(__dirname, "../../shared/fixtures");
const readJson = (f: string) => JSON.parse(readFileSync(join(fixtures, f), "utf8"));

function fail(msg: string, extra?: unknown): never {
  console.error("FAIL", msg, extra ?? "");
  process.exit(1);
}

async function main() {
  // 3. hashes
  const hashes = readJson("hashes.json");
  for (const type of ["github_commits", "url_live", "canvas_submission"]) {
    if (goalHashOf(readJson(`criteria.${type}.json`)) !== hashes.goal_hash[type]) fail(`goal_hash ${type}`);
    if (evidenceHashOf(readJson(`verdict.${type}.json`)) !== hashes.evidence_hash[type]) fail(`evidence_hash ${type}`);
  }
  console.log("OK goal/evidence hashes match shared/fixtures/hashes.json");

  // 2. nonce: abi.encode(uint256, bytes32) of static types is two 32-byte words
  const acct = privateKeyToAccount(generatePrivateKey());
  const cfg: Parameters<typeof signStakeAuthorization>[1] = {
    chainId: 84532,
    pool: "0x000000000000000000000000000000000000dEaD",
    token: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    tokenDomain: { name: "Agora Dollar", version: "1" },
  };
  const goalHash = hashes.goal_hash.github_commits as `0x${string}`;
  const value = 10_000_000n;

  for (let cohortId = 0; cohortId < 20; cohortId++) {
    const expected = keccak256(concat([pad(toHex(BigInt(cohortId)), { size: 32 }), goalHash]));
    if (authNonce(cohortId, goalHash) !== expected) fail(`authNonce cohort ${cohortId}`);

    // 1. signature
    const a = await signStakeAuthorization(acct, cfg, { cohortId, goalHash, value });
    if (a.nonce !== expected) fail("signed nonce is not authNonce", a);
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
      signature: serializeSignature({ r: a.r, s: a.s, v: BigInt(a.v) }),
    });
    if (recovered !== acct.address || ![27, 28].includes(a.v)) fail("signature does not recover", { a, recovered });
  }
  console.log("OK 20/20 nonces equal authNonce(cohortId, goalHash); signatures recover to staker, v in {27,28}");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
