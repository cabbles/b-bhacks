"use client";
import { getBond, getPredictionMarket } from "@/lib/api";
import { usePoll } from "@/lib/time";
import { fmtAmount } from "@/lib/wallet";

/** Live YES/NO bet totals and the owner's stake for a one-task market, read from the chain via the relayer. */
export function MarketTotals({ cohortId, owner, dec }: { cohortId: number; owner: string; dec: number }) {
  const { data: m } = usePoll(() => getPredictionMarket(cohortId, owner, owner), 5000, [cohortId, owner]);
  const { data: bond } = usePoll(() => getBond(cohortId, owner).catch(() => null), 10000, [cohortId, owner]);
  if (!m) return null;
  return (
    <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-4">
      <div>
        <div className="num text-6xl font-semibold text-pass sm:text-7xl">{fmtAmount(m.yes_total, dec)}</div>
        <div className="label !mb-0">AUSD bet YES</div>
      </div>
      <div>
        <div className="num text-6xl font-semibold text-fail sm:text-7xl">{fmtAmount(m.no_total, dec)}</div>
        <div className="label !mb-0">AUSD bet NO</div>
      </div>
      {bond && bond.amount !== "0" && (
        <div>
          <div className="num text-4xl font-semibold">{fmtAmount(bond.amount, dec)}</div>
          <div className="label !mb-0">owner&apos;s stake</div>
        </div>
      )}
    </div>
  );
}
