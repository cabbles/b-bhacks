"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { getGoal, relayClaim } from "@/lib/api";
import { countdown, fmtTime, short, useNow, usePoll } from "@/lib/time";
import type { GoalResponse } from "@/lib/types";
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

  if (error && !g) return <ErrorBox msg={error} />;
  if (!g) return <Spinner />;

  const { criteria, verdict, status } = g;
  const deadline = Date.parse(criteria.window.deadline) / 1000;
  const cohortId = g.cohort_id ?? verdict?.cohort_id;

  async function onClaim() {
    if (cohortId === undefined) return;
    setClaim({ busy: true });
    try {
      const r = await relayClaim(cohortId, criteria.staker);
      setClaim({ tx: r.tx_hash });
    } catch (e) {
      setClaim({ err: (e as Error).message });
    }
  }

  return (
    <div className="space-y-5">
      {isNew && (
        <div className="rounded-2xl border border-lime-400/40 bg-lime-400/10 p-3 text-sm text-lime-200">
          Staked. The referee is now watching. Bookmark this page.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={status} big />
        {cohortId !== undefined && (
          <Link href={`/cohorts/${cohortId}`} className="text-sm text-zinc-400 hover:text-white">
            Cohort #{cohortId} →
          </Link>
        )}
      </div>

      <div>
        <div className="label">Goal</div>
        <h1 className="text-2xl font-bold">{criteria.goal_text}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Staker <span className="font-mono">{short(criteria.staker)}</span> · {criteria.type} · deadline{" "}
          {fmtTime(criteria.window.deadline)}
        </p>
      </div>

      {status === "watching" && (
        <div className="card space-y-3">
          <div className="text-center">
            <div className="label">Time left</div>
            <div className="font-mono text-4xl font-black">{countdown(deadline, now)}</div>
          </div>
          <ControlProof criteria={criteria} />
        </div>
      )}

      {status === "needs_human" && !verdict && (
        <div className="card text-sm text-amber-200">
          The two model checks disagreed. A human will review this and the override will be shown publicly.
        </div>
      )}

      {verdict && (
        <>
          <div className={`rounded-2xl border p-5 ${verdict.passed ? "border-green-500/40 bg-green-500/10" : "border-red-500/40 bg-red-500/10"}`}>
            <div className="text-4xl font-black">{verdict.passed ? "PASS ✅" : "FAIL ❌"}</div>
            <p className="mt-2 text-lg">{verdict.reasons}</p>
            {verdict.human_override && (
              <p className="mt-2 text-sm font-semibold text-amber-300">A human overrode the automatic verdict. This is counted publicly.</p>
            )}
            <p className="mt-2 text-xs text-zinc-400">Decided {fmtTime(verdict.decided_at)}</p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold">Checks</h2>
            <ul className="space-y-2">
              {verdict.checks.map((c) => (
                <li key={c.name} className="card flex gap-3">
                  <span className={`mt-0.5 text-lg ${c.passed ? "text-green-400" : "text-red-400"}`}>{c.passed ? "✓" : "✗"}</span>
                  <div>
                    <div className="font-semibold">{CHECK_LABEL[c.name] ?? c.name}</div>
                    <div className="text-sm text-zinc-400">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {verdict.model_votes.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              {verdict.model_votes.map((m, i) => (
                <span key={i} className="rounded-full border border-zinc-700 px-3 py-1">
                  {m.model}: {m.passed ? "pass" : "fail"}
                </span>
              ))}
            </div>
          )}

          {verdict.evidence.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-bold">Evidence the referee saw</h2>
              <ul className="card divide-y divide-zinc-800 text-sm">
                {verdict.evidence.map((e, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-2 py-2 first:pt-0 last:pb-0">
                    <span>
                      <span className="text-zinc-400">{e.kind}</span> <span className="break-all font-mono">{e.ref}</span>
                    </span>
                    <span className="text-zinc-400">first seen {fmtTime(e.first_seen)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="card space-y-1 text-sm">
        <div><TxLink hash={g.stake_tx_hash} label="Stake tx" /></div>
        {(verdict || g.verdict_tx_hash) && <div><TxLink hash={g.verdict_tx_hash} label="Verdict tx" /></div>}
        {verdict && <div className="break-all font-mono text-xs text-zinc-500">goal_hash {verdict.goal_hash}</div>}
      </div>

      {verdict && cohortId !== undefined && (
        <div className="space-y-2">
          <button className="btn-ghost w-full" disabled={claim.busy || !!claim.tx} onClick={onClaim}>
            {claim.busy ? <Spinner /> : claim.tx ? "Claim sent" : verdict.passed ? "Claim payout" : "Trigger settlement claim"}
          </button>
          {claim.tx && <TxLink hash={claim.tx} label="Claim tx" />}
          <ErrorBox msg={claim.err ?? null} />
          <p className="text-xs text-zinc-500">Claims open once the cohort is settled (10 minutes after the deadline). Funds always go to the staker.</p>
        </div>
      )}

      <details className="text-xs text-zinc-400">
        <summary className="cursor-pointer">Raw criteria{verdict ? " and verdict" : ""} JSON</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-black/60 p-2">{JSON.stringify({ criteria, verdict }, null, 2)}</pre>
      </details>
    </div>
  );
}
