"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getCohort, getConfig } from "@/lib/api";
import { countdown, fmtTime, short, useNow, usePoll } from "@/lib/time";
import type { CohortResponse, GoalStatus } from "@/lib/types";
import { fmtAmount, tokenDecimals } from "@/lib/wallet";
import { ErrorBox, Spinner, Stat, StatusPill } from "@/components/ui";
import CountUp from "@/components/reactbits/CountUp";

const ORDER: Record<GoalStatus, number> = { needs_human: 0, watching: 1, passed: 2, failed: 3 };

export default function CohortBoard({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const now = useNow();
  const { data, error } = usePoll<CohortResponse>(() => getCohort(id), 5_000, [id]);
  const [dec, setDec] = useState(6);

  useEffect(() => {
    getConfig().then((c) => tokenDecimals(c.token, c.decimals).then(setDec)).catch(() => {});
  }, [id]);

  if (error && !data) return <ErrorBox msg={error} />;
  if (!data) return <Spinner />;

  const { cohort, goals, stats } = data;
  const stakingOpen = cohort.stake_deadline * 1000 > now;
  const working = !stakingOpen && cohort.goal_deadline * 1000 > now;
  const phase = stakingOpen ? "Open" : working ? "In progress" : cohort.settled ? "Settled" : "Judging";
  const target = stakingOpen ? cohort.stake_deadline : cohort.goal_deadline;
  const ticking = stakingOpen || working;
  const sorted = [...goals].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  return (
    <div className="space-y-12">
      {/* Market head: clock (or state) and pot on the left, terms and entry on the right. */}
      <section className="grid gap-10 border-b border-line pb-10 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="label">
            Market #{cohort.id} · {phase}
          </div>
          {ticking ? (
            <>
              <div className="num text-[24vw] font-semibold leading-[0.85] tracking-tight sm:text-[10rem] lg:text-[13rem]">
                {countdown(target, now)}
              </div>
              <div className="label mt-2">{stakingOpen ? "until staking closes" : "until the deadline"}</div>
            </>
          ) : (
            <div className="display text-[20vw] sm:text-[9rem] lg:text-[11rem]">{phase}.</div>
          )}
          <div className="mt-8 flex items-baseline gap-3">
            <span className="num text-6xl font-semibold text-accent sm:text-7xl">
              <CountUp to={Number(fmtAmount(stats.pot, dec).replace(/,/g, ""))} duration={1.2} separator="," />
            </span>
            <span className="label !mb-0">AUSD in the pot · no house, no fee</span>
          </div>
        </div>
        <aside className="lg:col-span-4">
          <div className="label">Terms</div>
          <dl className="grid grid-cols-2 border-t border-line text-sm [&>*]:border-b [&>*]:border-line [&>*]:py-3">
            <dt className="text-muted">Stake per task</dt>
            <dd className="num text-right">{fmtAmount(cohort.stake_amount, dec)} AUSD</dd>
            <dt className="text-muted">Staking closes</dt>
            <dd className="num text-right">{fmtTime(cohort.stake_deadline)}</dd>
            <dt className="text-muted">Deadline</dt>
            <dd className="num text-right">{fmtTime(cohort.goal_deadline)}</dd>
          </dl>
          {stakingOpen && (
            <div className="mt-5 flex flex-col gap-3">
              <Link href={`/stake?cohort=${cohort.id}`} className="btn-primary">Stake on a task</Link>
              <Link href="/split" className="btn-ghost">Split a project with friends</Link>
            </div>
          )}
        </aside>
      </section>

      <section className="grid grid-cols-3 gap-y-8 sm:grid-cols-5">
        <Stat label="Stakers" value={stats.stakers} />
        <Stat label="Watching" value={stats.watching} />
        <Stat label="Passed" value={stats.passed} tone="text-pass" />
        <Stat label="Failed" value={stats.failed} tone="text-fail" />
        <Stat label="Needs human" value={stats.needs_human} tone="text-human" />
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <div className="label">Stakers and their tasks</div>
          <div className="label">
            {stats.human_overrides ?? 0} human overrides · <Link className="hover:text-fg" href="/integrity">How it stays fair →</Link>
          </div>
        </div>
        <ul className="border-t border-line">
          {sorted.length === 0 && <li className="py-4 text-muted">No one has put a task on the board yet. Be the first.</li>}
          {sorted.map((g) => (
            <li key={g.goal_id}>
              <Link href={`/goals/${g.goal_id}`} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-x-4 border-b border-line py-3 hover:bg-panel">
                <span className="num text-xs text-muted">{short(g.staker)}</span>
                <span className="truncate">
                  {g.goal_text ?? g.type ?? g.goal_id}
                  {g.human_override && <span className="num ml-2 text-[10px] uppercase tracking-[0.14em] text-human">override</span>}
                </span>
                <StatusPill status={g.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {error && <p className="text-xs text-fail">Refresh failed: {error}</p>}
    </div>
  );
}
