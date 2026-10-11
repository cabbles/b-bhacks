"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getConfig } from "@/lib/api";
import { addrUrl, txUrl } from "@/lib/env";
import { countdown, short, useNow } from "@/lib/time";
import type { RelayerConfig } from "@/lib/types";
import { fmtAmount, myGoals, tokenBalance, tokenDecimals, useWallet, type MyGoal } from "@/lib/wallet";
import { ErrorBox, Spinner } from "@/components/ui";
import SplitText from "@/components/reactbits/SplitText";
import ClickSpark from "@/components/reactbits/ClickSpark";

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

  const open = (cfg?.cohorts || []).filter((c) => c.stake_deadline * 1000 > now);

  return (
    <div className="grid gap-y-14 lg:grid-cols-12 lg:gap-x-12">
      {/* Left: the pitch, set large. */}
      <section className="lg:col-span-7">
        <div className="label">Testnet · Base Sepolia · AUSD</div>
        <SplitText
          text="Do it, or pay."
          tag="h1"
          textAlign="left"
          className="display mt-4 text-[17vw] sm:text-8xl lg:text-[8.5rem]"
          delay={35}
          duration={0.6}
          splitType="chars"
        />
        <p className="display mt-2 text-[11vw] text-muted sm:text-6xl lg:text-7xl">
          A referee that <span className="text-accent">checks.</span>
        </p>
        <p className="mt-10 max-w-md text-lg leading-relaxed text-fg/80">
          Put AUSD behind any task with a deadline. An AI referee gathers the evidence itself, rules pass or fail with reasons,
          and posts the verdict on-chain where anyone can check it. Stakes from missed tasks go to the people who finished.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/stake" className="btn-primary">Commit to a task</Link>
          <Link href="/split" className="btn-ghost">Do it with friends</Link>
        </div>

        <ol className="mt-16 max-w-xl">
          {[
            ["Any task with evidence", "Today: code pushed to a public repo, or a page that goes live with the content you promised. You describe the task; the referee turns it into exact criteria."],
            ["Bring your friends", "Split a group project three ways and each of you bets on your part. Whoever delivers splits the stakes of whoever does not. The money stays in the group."],
            ["It looks for itself", "It reads the evidence directly and ignores uploads and claimed timestamps, so old or borrowed work does not count."],
            ["Every ruling is checkable", "Each verdict is posted on-chain with a hash of its full reasoning. Your browser recomputes it and compares."],
            ["Nobody can take the money", "The contract has no owner withdrawal. If no verdict is posted, everyone is refunded."],
            ["Agents can hire it too", "Other apps and AI agents can buy a ruling for 0.10 AUSD over x402: an HTTP 402, a gasless signature, a signed result. Groups never pay."],
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
              <a className="num break-all text-sm text-fg hover:text-accent" href={addrUrl(account.address)} target="_blank" rel="noreferrer">
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
          <div className="label">Open markets</div>
          <div className="border-t border-line">
            {!cfg && !err && (
              <div className="py-4">
                <Spinner />
              </div>
            )}
            {cfg && open.length === 0 && <p className="py-4 text-muted">No market is open right now.</p>}
            {open.map((c) => (
              <div key={c.id} className="border-b border-line py-5">
                <div className="flex items-baseline justify-between">
                  <span className="display text-4xl">#{c.id}</span>
                  <span className="num text-sm text-muted">{fmtAmount(c.stake_amount, dec)} AUSD per task</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-muted">Staking closes</dt>
                  <dd className="num text-right">{countdown(c.stake_deadline, now)}</dd>
                  <dt className="text-muted">Deadline</dt>
                  <dd className="num text-right">{countdown(c.goal_deadline, now)}</dd>
                </dl>
                <div className="mt-4 flex gap-3">
                  <div className="flex-1">
                    <ClickSpark sparkColor="#C6FF3D" sparkCount={10} sparkRadius={22}>
                      <Link href={`/stake?cohort=${c.id}`} className="btn-primary w-full">
                        Stake
                      </Link>
                    </ClickSpark>
                  </div>
                  <Link href={`/cohorts/${c.id}`} className="btn-ghost">
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {goals.length > 0 && (
          <section>
            <div className="label">Your goals</div>
            <ul className="border-t border-line">
              {goals.map((g) => (
                <li key={g.goal_id}>
                  <Link href={`/goals/${g.goal_id}`} className="flex gap-3 border-b border-line py-3 hover:text-accent">
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
