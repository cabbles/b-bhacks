"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getConfig, getGoal } from "@/lib/api";
import { calls, send } from "@/lib/tx";
import { MOCK } from "@/lib/env";
const LIVE = !MOCK;
import { payoutOf, verifyGoal, type Proof } from "@/lib/verify";
import { kindOf } from "@/lib/kinds";
import { fmtAmount, tokenDecimals, useWallet } from "@/lib/wallet";
import { countdown, fmtTime, short, useNow, usePoll } from "@/lib/time";
import type { GoalResponse } from "@/lib/types";
import { PredictionMarket } from "@/components/PredictionMarket";
import { BondPanel } from "@/components/BondPanel";
import { ControlProof } from "@/components/ControlProof";
import { ErrorBox, Spinner, StatusPill, TxLink } from "@/components/ui";

const CHECK_LABEL: Record<string, string> = {
  repo_control: "You control the repo",
  commits_in_window: "Commits first seen in the window",
  substance: "Work matches the goal (two models agree)",
  url_control: "You control the URL",
  url_content: "Page shows the required content",
  not_live_at_stake: "Page was not already live at stake time",
  canvas_submitted: "Canvas assignment submitted",
  canvas_min_bytes: "Submission is not empty",
};

export default function GoalPage({ params }: { params: { id: string } }) {
  const search = useSearchParams();
  const isNew = search.get("new") === "1";
  const now = useNow();
  const { data: g, error } = usePoll<GoalResponse>(() => getGoal(params.id), 10_000, [params.id]);
  const [claim, setClaim] = useState<{ busy?: boolean; tx?: string; err?: string }>({});
  const [proofs, setProofs] = useState<Proof[] | null>(null);
  const [claimable, setClaimable] = useState<{ amount: bigint; claimed: boolean; dec: number } | null>(null);
  const [round, setRound] = useState<{ market: boolean; settled: boolean } | null>(null);
  const { account } = useWallet();

  // Independent checks against the chain; re-run when the verdict or its tx appears.
  const verdictKey = `${g?.status}:${g?.verdict_tx_hash ?? ""}:${claim.tx ?? ""}`;
  useEffect(() => {
    if (!g || !LIVE) return;
    let alive = true;
    getConfig()
      .then(async (cfg) => {
        if (!cfg.poolDeployed) return;
        const [p, amount, dec] = await Promise.all([
          verifyGoal(g, cfg.pool),
          g.cohort_id !== undefined ? payoutOf(cfg.pool, g.cohort_id, g.criteria.staker) : null,
          tokenDecimals(cfg.token, cfg.decimals),
        ]);
        if (!alive) return;
        const cohort = g.cohort_id !== undefined ? cfg.cohorts.find((c) => c.id === g.cohort_id) : undefined;
        setRound(cohort ? { market: kindOf(cohort) === "group", settled: !!cohort.settled } : null);
        setProofs(p);
        setClaimable(amount !== null ? { ...amount, dec } : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdictKey]);

  if (error && !g) return <ErrorBox msg={error} />;
  if (!g) return <Spinner />;

  const { criteria, verdict, status } = g;
  const deadline = Date.parse(criteria.window.deadline) / 1000;
  const cohortId = g.cohort_id ?? verdict?.cohort_id;

  async function onClaim() {
    if (cohortId === undefined) return;
    setClaim({ busy: true });
    try {
      const { hash } = await send(calls.claimStake(cohortId, criteria.staker as `0x${string}`));
      setClaim({ tx: hash });
    } catch (e) {
      setClaim({ err: (e as Error).message });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-y-12 lg:grid-cols-12 lg:gap-x-12">
      {isNew && (
        <div className="border-l-2 border-accent pl-3 text-sm lg:col-span-12">Staked. The referee is now watching. Bookmark this page.</div>
      )}

      {/* Headline: the ruling, set as large as the screen allows. */}
      <header className="lg:col-span-12">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={status} big />
          {cohortId !== undefined && (
            <Link href={`/cohorts/${cohortId}`} className="label !mb-0 hover:text-fg">
              Market #{cohortId} →
            </Link>
          )}
        </div>
        {verdict ? (
          <div className={`display mt-6 text-[28vw] sm:text-[11rem] lg:text-[14rem] ${verdict.passed ? "text-pass" : "text-fail"}`}>
            {verdict.passed ? "PASS" : "FAIL"}
          </div>
        ) : status === "watching" ? (
          <div className="num mt-6 text-[18vw] font-semibold leading-none sm:text-9xl">{countdown(deadline, now)}</div>
        ) : (
          <div className="display mt-6 text-6xl text-human sm:text-8xl">Under review</div>
        )}
        <h1 className="mt-6 max-w-3xl font-display text-2xl font-bold leading-snug tracking-tight sm:text-4xl">{criteria.goal_text}</h1>
        <p className="num mt-2 text-xs text-muted">
          {short(criteria.staker)} · {criteria.type} · deadline {fmtTime(criteria.window.deadline)}
        </p>
      </header>

      {/* Main column: reasons and checks. */}
      <section className="space-y-10 lg:col-span-7">
        {status === "watching" && (
          <div className="border-t-2 border-accent pt-4">
            <div className="label">Before the deadline</div>
            <ControlProof criteria={criteria} />
          </div>
        )}

        {status === "needs_human" && !verdict && (
          <p className="border-l-2 border-human pl-3 text-human">
            The two model checks disagreed. A human will review this, and the override will be shown publicly.
          </p>
        )}

        {verdict && (
          <>
            <div>
              <div className="label">Reasons</div>
              <p className="border-t border-line pt-4 font-display text-2xl leading-snug tracking-tight">{verdict.reasons}</p>
              {verdict.human_override && <p className="mt-3 text-sm text-human">A human overrode the automatic verdict. This is counted publicly.</p>}
              <p className="num mt-3 text-xs text-muted">Decided {fmtTime(verdict.decided_at)}</p>
            </div>

            <div>
              <div className="label">Checks</div>
              <ol className="border-t border-line">
                {verdict.checks.map((c, i) => (
                  <li key={c.name} className="grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-3 border-b border-line py-4">
                    <span className="num text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <div className="font-medium">{CHECK_LABEL[c.name] ?? c.name}</div>
                      <div className="mt-0.5 text-sm text-muted">{c.detail}</div>
                    </div>
                    <span className={`num text-xs uppercase tracking-[0.14em] ${c.passed ? "text-pass" : "text-fail"}`}>{c.passed ? "pass" : "fail"}</span>
                  </li>
                ))}
              </ol>
              {verdict.model_votes.length > 0 && (
                <p className="num mt-3 text-xs text-muted">
                  {verdict.model_votes.map((m) => `${m.model}: ${m.passed ? "pass" : "fail"}`).join(" · ")}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* Side column: evidence, receipts, verification, claim. */}
      <aside className="space-y-10 lg:col-span-4 lg:col-start-9">
        {verdict && verdict.evidence.length > 0 && (
          <div>
            <div className="label">Evidence the referee saw</div>
            <ul className="border-t border-line text-sm">
              {verdict.evidence.map((e, i) => (
                <li key={i} className="border-b border-line py-3">
                  <div className="num break-all">{e.ref}</div>
                  <div className="text-xs text-muted">
                    {e.kind} · first seen {fmtTime(e.first_seen)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="label">On-chain</div>
          <div className="space-y-2 border-t border-line pt-3 text-sm">
            <div><TxLink hash={g.stake_tx_hash} label="Stake tx" /></div>
            {(verdict || g.verdict_tx_hash) && <div><TxLink hash={g.verdict_tx_hash} label="Verdict tx" /></div>}
            {verdict && <div className="num break-all text-[11px] text-muted">goal_hash {verdict.goal_hash}</div>}
          </div>
        </div>

        <div>
          <div className="label">Check it yourself</div>
          <div className="border-t border-line pt-3">
            {!LIVE ? (
              <p className="text-sm text-muted">Hash and on-chain checks run against live data only.</p>
            ) : !proofs ? (
              <Spinner />
            ) : (
              <ul className="space-y-3 text-sm">
                {proofs.map((p) => (
                  <li key={p.name}>
                    <div className="flex justify-between">
                      <span className="font-medium">{p.name}</span>
                      <span className={`num text-xs uppercase ${p.ok === null ? "text-muted" : p.ok ? "text-pass" : "text-fail"}`}>
                        {p.ok === null ? "n/a" : p.ok ? "match" : "mismatch"}
                      </span>
                    </div>
                    <div className="num break-all text-[11px] text-muted">{p.detail}</div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Computed in your browser from the JSON and Base Sepolia, without trusting the referee.</p>
          </div>
        </div>

        {/* Markets hold only a token entry, refunded automatically; their money is the creator's stake and the bets below. */}
        {verdict && cohortId !== undefined && !round?.market && (
          <div>
            <div className="label">{round?.market ? "Entry" : "Payout"}</div>
            <div className="space-y-2 border-t border-line pt-3 text-sm">
              {claimable?.claimed ? (
                <p>Paid to the task owner ({short(criteria.staker)}). Nothing left on this entry.</p>
              ) : claimable && claimable.amount > 0n ? (
                <>
                  <p>
                    <span className="num text-pass">{fmtAmount(claimable.amount, claimable.dec)} AUSD</span>{" "}
                    {round?.market ? "goes back to the owner" : "is ready for"} ({short(criteria.staker)})
                    {account && account.address.toLowerCase() !== criteria.staker.toLowerCase() ? ". Sending it still pays them, not you." : "."}
                  </p>
                  <button className="btn-primary w-full" disabled={claim.busy || !!claim.tx} onClick={onClaim}>
                    {claim.busy ? <Spinner /> : claim.tx ? "Sent" : round?.market ? "Refund entry to the owner" : `Pay ${short(criteria.staker)}`}
                  </button>
                </>
              ) : round?.market ? (
                <p className="text-muted">
                  {round.settled
                    ? "Nothing left to refund on the entry."
                    : "The entry is refunded to the owner after settlement. Winning bets pay the people who bet that side. The owner's stake goes back to them if they finish, or to the people who bet NO if they miss."}
                </p>
              ) : !round?.settled ? (
                <p className="text-muted">Claims open once the round settles, 10 minutes after the deadline. The payout goes to this task's staker.</p>
              ) : verdict.passed ? (
                <p className="text-muted">Nothing left to claim for this staker.</p>
              ) : (
                <p className="text-muted">This stake goes to the people who finished.</p>
              )}
              {claim.tx && <TxLink hash={claim.tx} label="Claim tx" />}
              <ErrorBox msg={claim.err ?? null} />
            </div>
          </div>
        )}

        {cohortId !== undefined && <BondPanel cohortId={cohortId} owner={criteria.staker} />}
        {cohortId !== undefined && <PredictionMarket cohortId={cohortId} owner={criteria.staker} />}

        <details className="text-xs text-muted">
          <summary className="cursor-pointer hover:text-fg">Raw criteria{verdict ? " and verdict" : ""} JSON</summary>
          <pre className="num mt-2 overflow-x-auto border border-line bg-panel p-3">{JSON.stringify({ criteria, verdict }, null, 2)}</pre>
        </details>
      </aside>
    </div>
  );
}
