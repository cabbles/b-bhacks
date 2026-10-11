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
    // Breaks out of the layout's max-w-3xl so the board fills a projector.
    <div className="relative left-1/2 w-[min(80rem,calc(100vw-2rem))] -translate-x-1/2 space-y-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="flex-1">
          <div className="label">Cohort #{cohort.id} · {phase}</div>
          <div className="font-mono text-6xl font-black tabular-nums sm:text-7xl lg:text-9xl">{countdown(target, now)}</div>
          <div className="text-sm text-zinc-400">{stakingOpen ? "until staking closes" : "until the goal deadline"}</div>
          <div className="mt-3 text-3xl font-black text-lime-300 lg:text-5xl">
            {fmtAmount(stats.pot, dec)} <span className="text-lg text-zinc-400">AUSD in the pot</span>
          </div>
        </div>
        {joinUrl && (
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-2xl bg-white p-3">
              <QRCodeSVG value={joinUrl} size={180} className="h-44 w-44 lg:h-72 lg:w-72" />
            </div>
            <div className="text-xs text-zinc-400">Scan to join · no install</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="Stakers" value={stats.stakers} />
        <Stat label="Watching" value={stats.watching} />
        <Stat label="Passed" value={<span className="text-green-400">{stats.passed}</span>} />
        <Stat label="Failed" value={<span className="text-red-400">{stats.failed}</span>} />
        <Stat label="Needs human" value={<span className="text-amber-400">{stats.needs_human}</span>} />
      </div>
      {(stats.attacks !== undefined || stats.human_overrides !== undefined) && (
        <p className="text-sm text-zinc-400">
          {stats.attacks ?? 0} declared cheat attempts ·{" "}
          <Link className="link" href="/fool">Fool the Ref board</Link> · {stats.human_overrides ?? 0} human overrides
        </p>
      )}

      <ul className="grid gap-2 lg:grid-cols-2">
        {sorted.length === 0 && <li className="text-zinc-400">No stakers yet. Be the first.</li>}
        {sorted.map((g) => (
          <li key={g.goal_id}>
            <Link href={`/goals/${g.goal_id}`} className="card flex items-center gap-3 hover:border-zinc-600">
              <span className="font-mono text-xs text-zinc-500">{short(g.staker)}</span>
              <span className="flex-1 truncate">
                {g.is_attack && <span title="Declared cheat attempt">😈 </span>}
                {g.goal_text ?? g.type ?? g.goal_id}
              </span>
              {g.human_override && <span className="text-xs text-amber-300">override</span>}
              <StatusPill status={g.status} />
            </Link>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-400">Refresh failed: {error}</p>}
    </div>
  );
}
