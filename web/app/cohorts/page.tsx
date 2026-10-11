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
          <div className="label">Prediction markets</div>
          <h1 className="display text-6xl sm:text-8xl">Markets.</h1>
          <p className="mt-4 max-w-xl text-lg text-fg/80">
            Each market is one person's task, backed by their own stake. Bet YES or NO on whether they finish, or create one on
            yourself and share it. Just want to stake on yourself, no betting? <a className="link" href="/stake">Make a solo stake</a>.
          </p>
        </div>
        <Link href="/cohorts/new" className="btn-primary">Create a market</Link>
      </header>

      {error && !cfg && <ErrorBox msg={error} />}
      {!cfg && !error && <Spinner />}

      {cfg && (
        <section>
          <div className="label">Open for betting</div>
          {open.length === 0 ? (
            <div className="card flex flex-wrap items-center justify-between gap-4">
              <p className="text-fg/80">No market is open right now. Create one on yourself and share it.</p>
              <Link href="/cohorts/new" className="btn-ghost">Create a market</Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {open.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
                  <span className="display w-20 text-4xl">#{c.id}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-display text-lg font-semibold">
                      One task · open it to see the bets
                    </div>
                    <div className="num text-muted">
                      betting closes in {countdown(c.stake_deadline, now)} · deadline in {countdown(c.goal_deadline, now)}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Link href={`/stake?cohort=${c.id}`} className="btn-primary">View &amp; bet</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <div className="label">Betting closed</div>
          <ul className="divide-y divide-line">
            {rest.map((c) => (
              <li key={c.id}>
                <Link href={`/cohorts/${c.id}`} className="flex items-center gap-6 py-4 hover:text-nose-deep">
                  <span className="display w-20 text-3xl">#{c.id}</span>
                  <span className="flex-1 text-sm">
                    One task · open it to see the bets
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
