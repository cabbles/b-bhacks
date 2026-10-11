"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getCohort, getConfig } from "@/lib/api";
import { WEB_URL } from "@/lib/env";
import { countdown, short, useNow, usePoll } from "@/lib/time";
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
  const [joinUrl, setJoinUrl] = useState("");

  useEffect(() => {
    getConfig().then((c) => tokenDecimals(c.token, c.decimals).then(setDec)).catch(() => {});
    setJoinUrl(`${WEB_URL || window.location.origin}/stake?cohort=${id}`);
  }, [id]);

  if (error && !data) return <ErrorBox msg={error} />;
  if (!data) return <Spinner />;

  const { cohort, goals, stats } = data;
  const stakingOpen = cohort.stake_deadline * 1000 > now;
  const phase = stakingOpen ? "Staking open" : cohort.goal_deadline * 1000 > now ? "Goals in progress" : cohort.settled ? "Settled" : "Judging";
  const target = stakingOpen ? cohort.stake_deadline : cohort.goal_deadline;
  const sorted = [...goals].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  return (
    <div className="space-y-12">
      {/* Scoreboard head: clock and pot huge on the left, QR in a ruled corner on the right. */}
      <section className="grid gap-10 border-b border-line pb-10 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="label">
            Cohort #{cohort.id} · {phase}
          </div>
          <div className="num text-[24vw] font-semibold leading-[0.85] tracking-tight sm:text-[10rem] lg:text-[13rem]">
            {countdown(target, now)}
          </div>
          <div className="label mt-2">{stakingOpen ? "until staking closes" : "until the goal deadline"}</div>
          <div className="mt-8 flex items-baseline gap-3">
            <span className="num text-6xl font-semibold text-accent sm:text-7xl">
              <CountUp to={Number(fmtAmount(stats.pot, dec).replace(/,/g, ""))} duration={1.2} separator="," />
            </span>
            <span className="label !mb-0">AUSD in the pot · no house, no fee</span>
          </div>
        </div>
        {joinUrl && (
          <div className="flex flex-col items-start gap-3 lg:col-span-4 lg:items-end">
            <div className="bg-fg p-3">
              <QRCodeSVG value={joinUrl} size={180} bgColor="#ECEDEE" fgColor="#0D0F12" className="h-40 w-40 lg:h-64 lg:w-64" />
            </div>
            <div className="label !mb-0">Scan to join · no install</div>
            <Link href="/split" className="label !mb-0 hover:text-fg">Split a project three ways →</Link>
          </div>
        )}
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
