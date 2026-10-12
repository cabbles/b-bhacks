"use client";
import { useState } from "react";
import { claimBond, getBond, getConfig } from "@/lib/api";
import { MOCK } from "@/lib/env";
import { short, usePoll } from "@/lib/time";
import { fmtAmount, useWallet } from "@/lib/wallet";
import { ErrorBox, Spinner, TxLink } from "./ui";

const RESULT = {
  pending: "Held until the verdict.",
  returned: "Returned to the owner: they finished (or no verdict was posted).",
  to_no: "The owner missed it. Their stake is split among the people who bet NO.",
  burned: "The owner missed it and nobody bet NO, so their stake was burned.",
} as const;

/** The task owner's own stake, separate from the YES/NO bets. */
export function BondPanel({ cohortId, owner }: { cohortId: number; owner: `0x${string}` }) {
  const { account } = useWallet();
  const { data: cfg } = usePoll(getConfig, 30_000);
  const [tx, setTx] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: bond } = usePoll(
    () => (cfg?.bond_pool ? getBond(cohortId, owner, account?.address) : Promise.resolve(null)),
    8000,
    [cfg?.bond_pool, cohortId, owner, account?.address, tx],
  );
  if (MOCK || !cfg?.bond_pool || !bond || bond.amount === "0") return null;
  const dec = cfg.decimals ?? 6;
  const claimable = BigInt(bond.claimable);

  async function onClaim() {
    if (!account) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await claimBond({ cohort_id: cohortId, owner, bettor: account.address });
      setTx(r.tx_hash);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="label">Owner&apos;s stake</div>
      <div className="num text-3xl font-semibold">{fmtAmount(bond.amount, dec)} AUSD</div>
      <p className="mt-2 text-sm text-fg/75">
        Separate from the bets. Finish: the owner gets exactly this back. Miss: it goes to the people who bet NO.
      </p>
      <p className="mt-2 text-sm font-medium">{RESULT[bond.result]}</p>
      {claimable > 0n && account && (
        <>
          <p className="mt-3 text-sm">
            {fmtAmount(bond.claimable, dec)} AUSD of this stake is yours to claim. It pays your wallet ({short(account.address)}).
          </p>
          <button type="button" className="btn-primary mt-4 w-full" disabled={busy} onClick={onClaim}>
            {busy ? <Spinner /> : "Claim my share"}
          </button>
        </>
      )}
      {tx && <div className="mt-2 text-sm"><TxLink hash={tx} label="Claimed" /></div>}
      <ErrorBox msg={err} />
    </section>
  );
}
