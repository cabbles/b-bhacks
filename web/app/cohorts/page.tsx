"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getConfig } from "@/lib/api";
import { countdown, useNow, usePoll } from "@/lib/time";
import type { Cohort } from "@/lib/types";
import { fmtAmount, tokenDecimals } from "@/lib/wallet";
import { ErrorBox, Spinner } from "@/components/ui";
import { kindOf } from "@/lib/kinds";

function phase(c: Cohort, now: number) {
  if (c.stake_deadline * 1000 > now) return "open";
  if (c.goal_deadline * 1000 > now) return "in progress";
  return c.settled ? "paid out" : "judging";
}

/** Every market, open ones first, with the way to start a new one. */
export default function Markets() {
  const now = useNow();
  const { data: cfg, error } = usePoll(getConfig, 10_000);
  const [dec, setDec] = useState(6);
  useEffect(() => {
    if (cfg) tokenDecimals(cfg.token, cfg.decimals).then(setDec);
  }, [cfg]);

  const all = [...(cfg?.cohorts ?? [])].filter((c) => kindOf(c) === "group").sort((a, b) => b.id - a.id);
  const open = all.filter((c) => c.stake_deadline * 1000 > now);
  const rest = all.filter((c) => c.stake_deadline * 1000 <= now);

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="label">Group prediction markets</div>
          <h1 className="display text-6xl sm:text-8xl">Group markets.</h1>
          <p className="mt-4 max-w-xl text-lg text-fg/80">
            Start a market with friends and send the link. Everyone in it commits to their own task by the same deadline, and anyone can
            bet YES or NO on each person. Just want to bet on yourself? <a className="link" href="/stake">Make a solo stake</a>.
          </p>
        </div>
        <Link href="/cohorts/new" className="btn-primary">Start a group market</Link>
      </header>

      {error && !cfg && <ErrorBox msg={error} />}
      {!cfg && !error && <Spinner />}

      {cfg && (
        <section>
          <div className="label">Open to join</div>
          {open.length === 0 ? (
            <div className="card flex flex-wrap items-center justify-between gap-4">
              <p className="text-fg/80">No market is open right now. Start one and invite people.</p>
              <Link href="/cohorts/new" className="btn-ghost">Start a market</Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {open.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
                  <span className="display w-20 text-4xl">#{c.id}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-display text-lg font-semibold">
                      {fmtAmount(c.stake_amount, dec)} AUSD per person · {c.staker_count ?? 0} joined
                    </div>
                    <div className="num text-muted">
                      joining closes in {countdown(c.stake_deadline, now)} · deadline in {countdown(c.goal_deadline, now)}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Link href={`/stake?cohort=${c.id}`} className="btn-primary">Join</Link>
                    <Link href={`/cohorts/${c.id}`} className="btn-ghost">View &amp; bet</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <div className="label">Closed to new people</div>
          <ul className="divide-y divide-line">
            {rest.map((c) => (
              <li key={c.id}>
                <Link href={`/cohorts/${c.id}`} className="flex items-center gap-6 py-4 hover:text-nose-deep">
                  <span className="display w-20 text-3xl">#{c.id}</span>
                  <span className="flex-1 text-sm">
                    {fmtAmount(c.stake_amount, dec)} AUSD per person · {c.staker_count ?? 0} joined
                  </span>
                  <span className="label !mb-0">{phase(c, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
