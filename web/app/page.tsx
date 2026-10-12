"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getConfig } from "@/lib/api";
import { addrUrl, txUrl } from "@/lib/env";
import { countdown, short, useNow } from "@/lib/time";
import type { Cohort, RelayerConfig } from "@/lib/types";
import { fmtAmount, myGoals, tokenBalance, tokenDecimals, useWallet, type MyGoal } from "@/lib/wallet";
import { ErrorBox, Spinner } from "@/components/ui";
import { Cow } from "@/components/Cow";
import { useLiveMarket } from "@/components/useLiveMarket";
import { kindOf } from "@/lib/kinds";

function OpenMarket({ c, dec, now }: { c: Cohort; dec: number; now: number }) {
  const live = useLiveMarket(c.id, dec);
  return (
    <div className="border-b border-line py-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="display text-4xl">#{c.id}</span>
        {live.bets && <span className="num text-right text-sm text-muted">{live.bets}</span>}
      </div>
      <p className="mt-2 line-clamp-2 font-display text-lg font-semibold">{live.title}</p>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-muted">Betting closes</dt>
        <dd className="num text-right">{countdown(c.stake_deadline, now)}</dd>
        <dt className="text-muted">Deadline</dt>
        <dd className="num text-right">{countdown(c.goal_deadline, now)}</dd>
      </dl>
      <Link href={live.href} className="btn-primary mt-4 w-full">View &amp; bet</Link>
    </div>
  );
}

export default function JoinPage() {
  const { account, dripState, dripTx, retryDrip } = useWallet();
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
    tokenDecimals(cfg.token, cfg.decimals).then(setDec);
    const load = () => tokenBalance(cfg.token, account.address).then(setBal);
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [cfg, account, dripState]);

  const open = (cfg?.cohorts || []).filter((c) => c.stake_deadline * 1000 > now && kindOf(c) === "group");

  return (
    <div className="grid grid-cols-1 gap-y-14 lg:grid-cols-12 lg:gap-x-12">
      {/* Left: the pitch, set large. */}
      <section className="lg:col-span-7">
        <div className="flex min-w-0 items-end justify-between gap-6">
          <div>
            <div className="label">Cash Cow · testnet AUSD on Base Sepolia</div>
            <h1 className="display mt-4 text-[15vw] sm:text-7xl lg:text-[6.25rem]">Do it, or pay.</h1>
          </div>
          <Cow full size={150} className="hidden shrink-0 sm:block" />
        </div>
        <p className="display mt-3 text-[10vw] text-muted sm:text-5xl lg:text-6xl">
          A referee that <span className="text-nose-deep">checks.</span>
        </p>
        <p className="mt-10 max-w-md text-lg leading-relaxed text-fg/80">
          Put AUSD behind any task with a deadline. An AI referee gathers the evidence itself, rules pass or fail with reasons,
          and posts the verdict on-chain where anyone can check it. Stakes from missed tasks go to the people who finished.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="card flex flex-col">
            <div className="label">Solo stake</div>
            <div className="font-display text-3xl font-semibold">Bet on yourself.</div>
            <p className="mt-2 flex-1 text-fg/75">Put AUSD behind your own task. Finish by the deadline and you get it back. Miss it and you lose it.</p>
            <Link href="/stake" className="btn-primary mt-5">Make a solo stake</Link>
          </div>
          <div className="card flex flex-col">
            <div className="label">Prediction market</div>
            <div className="font-display text-3xl font-semibold">Bet on someone.</div>
            <p className="mt-2 flex-1 text-fg/75">Put a task up with your own stake, or bet YES or NO on whether someone else finishes theirs.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/cohorts/new" className="btn-primary">Create a market</Link>
              <Link href="/cohorts" className="btn-ghost">Browse</Link>
            </div>
          </div>
        </div>

        <ol className="mt-16 max-w-xl">
          {[
            ["Any task with evidence", "Today: code pushed to a public repo, or a page that goes live with the content you promised. You describe the task; the referee turns it into exact criteria."],
            ["It looks for itself", "It reads the evidence directly and ignores uploads and claimed timestamps, so old or borrowed work does not count."],
            ["Every ruling is checkable", "Each verdict is posted on-chain with a hash of its full reasoning. Your browser recomputes it and compares."],
            ["Nobody can take the money", "The contract has no owner withdrawal. If no verdict is posted, everyone is refunded."],
            ["Agents can hire it too", "Other apps and AI agents can buy a ruling for 0.10 AUSD over x402: an HTTP 402, a gasless signature, a signed result. Stakers never pay."],
          ].map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[3rem_1fr] gap-x-4 border-t border-line py-5">
              <span className="num text-sm text-muted">0{i + 1}</span>
              <div>
                <div className="font-display text-xl font-bold tracking-tight">{t}</div>
                <p className="mt-1 text-fg/70">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Right: a ruled ticket column, offset down on wide screens. */}
      <aside className="space-y-10 lg:col-span-5 lg:pt-28">
        <section>
          <div className="label">Your wallet · made in this browser</div>
          <div className="border-t border-line pt-3">
            {account ? (
              <a className="num break-all text-sm text-fg hover:text-nose-deep" href={addrUrl(account.address)} target="_blank" rel="noreferrer">
                {account.address}
              </a>
            ) : (
              <Spinner />
            )}
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Balance</dt>
              <dd className="num text-right text-2xl font-semibold">
                {bal === null ? "…" : fmtAmount(bal, dec)} <span className="text-sm text-muted">AUSD</span>
              </dd>
              <dt className="text-muted">Faucet</dt>
              <dd className="text-right">
                {dripState === "pending" && (
                  <span className="text-muted">
                    <Spinner /> sending 100
                  </span>
                )}
                {dripState === "done" &&
                  (dripTx ? (
                    <a className="link" href={txUrl(dripTx)} target="_blank" rel="noreferrer">
                      100 sent ↗
                    </a>
                  ) : (
                    <span className="text-muted">received</span>
                  ))}
                {dripState === "error" && (
                  <button type="button" className="link text-fail" onClick={retryDrip}>
                    failed · try again
                  </button>
                )}
              </dd>
            </dl>
            <p className="mt-4 text-xs text-muted">No install, no seed phrase. Clearing this browser&apos;s data loses the wallet.</p>
          </div>
        </section>

        <ErrorBox msg={err} />

        <section>
          <div className="label">Open markets · bet now</div>
          <div className="border-t border-line">
            {!cfg && !err && (
              <div className="py-4">
                <Spinner />
              </div>
            )}
            {cfg && open.length === 0 && <p className="py-4 text-muted">No market is open right now. <Link href="/cohorts/new" className="link">Start one</Link>.</p>}
            {open.map((c) => (
              <OpenMarket key={c.id} c={c} dec={dec} now={now} />
            ))}
          </div>
        </section>

        {goals.length > 0 && (
          <section>
            <div className="label">Your goals</div>
            <ul className="border-t border-line">
              {goals.map((g) => (
                <li key={g.goal_id}>
                  <Link href={`/goals/${g.goal_id}`} className="flex gap-3 border-b border-line py-3 hover:text-nose-deep">
                    <span className="num text-xs text-muted">#{g.cohort_id}</span>
                    <span className="flex-1">{g.goal_text}</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
