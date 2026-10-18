"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getConfig } from "@/lib/api";
import { countdown, useNow, usePoll } from "@/lib/time";
import type { Cohort, ChainConfig } from "@/lib/types";
import { tokenDecimals, useWallet } from "@/lib/wallet";
import { ErrorBox, Spinner } from "@/components/ui";
import { useLiveMarket } from "@/components/useLiveMarket";
import { isMarket } from "@/lib/kinds";
import { QuickBet } from "@/components/QuickBet";
import { MOCK } from "@/lib/env";

function phase(c: Cohort, now: number) {
  if (c.stake_deadline * 1000 > now) return "open";
  if (c.goal_deadline * 1000 > now) return "in progress";
  return c.settled ? "paid out" : "judging";
}

function MarketRow({ c, dec, now, open, cfg }: { c: Cohort; dec: number; now: number; open: boolean; cfg?: ChainConfig }) {
  const live = useLiveMarket(c.id, dec);
  const { account } = useWallet();
  const [betting, setBetting] = useState(false);
  // Creators can't bet on their own market (the contract refuses it), so their rows show "Yours" instead.
  const mine = !!live.owner && account?.address.toLowerCase() === live.owner.toLowerCase();
  const canQuickBet = !MOCK && !!cfg?.market_pool && !!live.owner && !mine;
  if (!open) {
    return (
      <li>
        <Link href={live.href} className="flex items-center gap-6 py-4 hover:text-nose-deep">
          <span className="display w-20 shrink-0 text-3xl">#{c.id}</span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block truncate font-display text-lg font-semibold">{mine && <YoursTag />}{live.title}</span>
            {live.bets && <span className="num text-muted">{live.bets}</span>}
          </span>
          <span className="label !mb-0">{phase(c, now)}</span>
        </Link>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
      <span className="display w-20 text-4xl">#{c.id}</span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="truncate font-display text-lg font-semibold">{mine && <YoursTag />}{live.title}</div>
        <div className="num text-muted">
          {live.bets ? `${live.bets} · ` : ""}
          betting closes in {countdown(c.stake_deadline, now)} · deadline in {countdown(c.goal_deadline, now)}
        </div>
      </div>
      <div className="flex gap-2">
        {canQuickBet && (
          <button type="button" className={betting ? "btn-ghost" : "btn-primary"} aria-expanded={betting} onClick={() => setBetting((b) => !b)}>
            {betting ? "Close" : "Bet"}
          </button>
        )}
        <Link href={live.href} className={canQuickBet ? "btn-ghost" : "btn-primary"}>View</Link>
      </div>
      {betting && canQuickBet && (
        <QuickBet cohortId={c.id} owner={live.owner as `0x${string}`} title={live.title} cfg={cfg!} onClose={() => setBetting(false)} />
      )}
    </li>
  );
}

function YoursTag() {
  return <span className="mr-2 rounded-full bg-fg px-2 py-0.5 align-middle font-mono text-[10px] uppercase tracking-wider text-ink" title="You created this market, so you can't bet on it">Yours</span>;
}

/** Every market, open ones first, with the way to start a new one. */
export default function Markets() {
  const now = useNow();
  const { data: cfg, error } = usePoll(getConfig, 10_000);
  const [dec, setDec] = useState(6);
  useEffect(() => {
    if (cfg) tokenDecimals(cfg.token, cfg.decimals).then(setDec);
  }, [cfg]);

  const all = [...(cfg?.cohorts ?? [])].filter((c) => isMarket(c)).sort((a, b) => b.id - a.id);
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
            yourself and share it. You can bet on anyone's market except your own. <Link className="link" href="/stake">See your markets</Link>.
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
                <MarketRow key={c.id} c={c} dec={dec} now={now} open cfg={cfg} />
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
              <MarketRow key={c.id} c={c} dec={dec} now={now} open={false} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
