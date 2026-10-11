"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getConfig } from "@/lib/api";
import { addrUrl, txUrl } from "@/lib/env";
import { countdown, short, useNow } from "@/lib/time";
import type { RelayerConfig } from "@/lib/types";
import { fmtAmount, myGoals, tokenBalance, tokenDecimals, useWallet, type MyGoal } from "@/lib/wallet";
import { ErrorBox, Spinner } from "@/components/ui";

export default function JoinPage() {
  const { account, dripState, dripTx } = useWallet();
  const [cfg, setCfg] = useState<RelayerConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const [dec, setDec] = useState(6);
  const [goals, setGoals] = useState<MyGoal[]>([]);
  const now = useNow();

  useEffect(() => {
    getConfig().then(setCfg).catch((e: Error) => setErr(e.message));
    setGoals(myGoals());
  }, []);

  useEffect(() => {
    if (!cfg || !account) return;
    tokenDecimals(cfg.token).then(setDec);
    const load = () => tokenBalance(cfg.token, account.address).then(setBal);
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [cfg, account, dripState]);

  const open = (cfg?.cohorts || []).filter((c) => c.stake_deadline * 1000 > now);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-black leading-tight sm:text-4xl">
          Bet on yourself.
          <br />
          <span className="text-lime-300">The referee checks.</span>
        </h1>
        <p className="mt-3 text-zinc-300">
          Stake testnet AUSD on finishing something by a deadline. An AI referee gathers the evidence itself, rules pass or fail
          with reasons, and the contract pays out. Forfeits go to the people who passed.
        </p>
      </section>

      <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
        <strong>Testnet only.</strong> This runs on Base Sepolia with free test tokens. Nothing here has real value and there is
        nothing to buy.
      </section>

      <section className="card space-y-2">
        <div className="label">Your wallet (created in this browser)</div>
        {account ? (
          <a className="link break-all font-mono text-sm" href={addrUrl(account.address)} target="_blank" rel="noreferrer">
            {account.address}
          </a>
        ) : (
          <Spinner />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-300">
          <span>
            Balance: <strong>{bal === null ? "…" : fmtAmount(bal, dec)} AUSD</strong>
          </span>
          <span>
            {dripState === "pending" && (
              <>
                <Spinner /> Sending you 100 test AUSD…
              </>
            )}
            {dripState === "done" && dripTx && (
              <a className="link" href={txUrl(dripTx)} target="_blank" rel="noreferrer">
                100 AUSD sent ↗
              </a>
            )}
            {dripState === "error" && <span className="text-red-300">Faucet failed. Refresh to retry.</span>}
          </span>
        </div>
        <p className="text-xs text-zinc-500">No install, no seed phrase. Clearing this browser&apos;s data loses this wallet.</p>
      </section>

      <ErrorBox msg={err} />

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Open cohorts</h2>
        {!cfg && !err && <Spinner />}
        {cfg && open.length === 0 && <p className="text-zinc-400">No cohort is taking stakes right now.</p>}
        {open.map((c) => (
          <div key={c.id} className="card flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <div className="font-bold">Cohort #{c.id}</div>
              <div className="text-sm text-zinc-400">
                Stake {fmtAmount(c.stake_amount, dec)} AUSD · staking closes in {countdown(c.stake_deadline, now)} · goal due in{" "}
                {countdown(c.goal_deadline, now)}
              </div>
            </div>
            <Link href={`/cohorts/${c.id}`} className="btn-ghost">Board</Link>
            <Link href={`/stake?cohort=${c.id}`} className="btn-primary">Stake</Link>
          </div>
        ))}
      </section>

      {goals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Your goals</h2>
          {goals.map((g) => (
            <Link key={g.goal_id} href={`/goals/${g.goal_id}`} className="card block hover:border-zinc-600">
              <div className="text-sm text-zinc-400">Cohort #{g.cohort_id}</div>
              <div>{g.goal_text}</div>
            </Link>
          ))}
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["It looks for itself", "The referee watches your repo or URL directly. Uploads and claimed timestamps are ignored, so a backdated commit does not count."],
          ["Try to fool it", "Declare a cheat attempt before the deadline. Every attempt goes on a public board, including the ones that worked."],
          ["It cannot profit", "The contract has no owner withdrawal. If no verdict is posted, you get a full refund."],
        ].map(([t, d]) => (
          <div key={t} className="card">
            <div className="font-bold text-lime-300">{t}</div>
            <p className="mt-1 text-sm text-zinc-300">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
