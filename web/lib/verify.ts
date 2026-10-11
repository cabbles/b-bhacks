import { decodeEventLog, isAddressEqual, zeroHash } from "viem";
import { client, poolAbi } from "./chain";
import { evidenceHashOf, goalHashOf } from "./hashes";
import type { GoalResponse } from "./types";

export type Proof = { name: string; ok: boolean | null; detail: string };

/**
 * Re-derive what the referee claims, from the data and from the chain, without trusting the referee:
 * the goal hash, the evidence hash, the Verdict event in the verdict tx, and the stake recorded by the pool.
 */
export async function verifyGoal(g: GoalResponse, pool: `0x${string}`): Promise<Proof[]> {
  const out: Proof[] = [];
  const cohortId = BigInt(g.cohort_id ?? g.verdict?.cohort_id ?? 0);
  const staker = g.criteria.staker;
  const goalHash = goalHashOf(g.criteria);

  if (g.verdict) {
    out.push({
      name: "Goal hash",
      ok: goalHash === g.verdict.goal_hash,
      detail: `keccak256(canonical(criteria)) = ${goalHash}`,
    });
  }

  try {
    const [onChainGoal] = await client.readContract({ address: pool, abi: poolAbi, functionName: "stakes", args: [cohortId, staker] });
    out.push({
      name: "Stake on-chain",
      ok: onChainGoal !== zeroHash && onChainGoal === goalHash,
      detail: onChainGoal === zeroHash ? "pool has no stake for this staker" : `pool records goalHash ${onChainGoal}`,
    });
  } catch (e) {
    out.push({ name: "Stake on-chain", ok: null, detail: `could not read pool: ${(e as Error).message.split("\n")[0]}` });
  }

  if (!g.verdict) return out;
  const evidenceHash = evidenceHashOf(g.verdict);
  if (g.evidence_hash) {
    out.push({ name: "Evidence hash", ok: evidenceHash === g.evidence_hash, detail: `keccak256(canonical(verdict)) = ${evidenceHash}` });
  }

  if (!g.verdict_tx_hash) {
    out.push({ name: "Verdict on-chain", ok: null, detail: "verdict not posted yet" });
    return out;
  }
  try {
    const receipt = await client.getTransactionReceipt({ hash: g.verdict_tx_hash as `0x${string}` });
    const ev = receipt.logs
      .filter((l) => isAddressEqual(l.address, pool))
      .map((l) => {
        try {
          return decodeEventLog({ abi: poolAbi, ...l });
        } catch {
          return null;
        }
      })
      .find((d) => d?.eventName === "Verdict" && d.args.cohortId === cohortId && isAddressEqual(d.args.staker, staker));
    if (!ev || ev.eventName !== "Verdict") {
      out.push({ name: "Verdict on-chain", ok: false, detail: "no matching Verdict event in the verdict tx" });
    } else {
      const ok = ev.args.evidenceHash === evidenceHash && ev.args.passed === g.verdict.passed;
      out.push({
        name: "Verdict on-chain",
        ok,
        detail: `event says ${ev.args.passed ? "pass" : "fail"}, evidenceHash ${ev.args.evidenceHash}${ok ? " (matches this verdict JSON)" : " (does NOT match this verdict JSON)"}`,
      });
    }
  } catch (e) {
    out.push({ name: "Verdict on-chain", ok: null, detail: `could not read receipt: ${(e as Error).message.split("\n")[0]}` });
  }
  return out;
}

/** What the staker can collect now, and whether they already have (from the pool, not the referee). */
export async function payoutOf(
  pool: `0x${string}`,
  cohortId: number,
  staker: `0x${string}`,
): Promise<{ amount: bigint; claimed: boolean } | null> {
  try {
    const [amount, stake] = await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "claimable", args: [BigInt(cohortId), staker] }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "stakes", args: [BigInt(cohortId), staker] }),
    ]);
    return { amount, claimed: stake[2] };
  } catch {
    return null;
  }
}
