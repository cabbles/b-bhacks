"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { calls, createdCohortId, send } from "@/lib/tx";
import { GROUP_TAG } from "@/lib/kinds";
import { useWallet } from "@/lib/wallet";
import { MARKET_ENTRY } from "@/lib/kinds";
import { ErrorBox, Spinner } from "@/components/ui";
import { ConnectOptions } from "@/components/Wallet";
import { GithubConnect } from "@/components/GithubConnect";

const JOIN = [
  { label: "15 minutes", min: 15 },
  { label: "1 hour", min: 60 },
  { label: "1 day", min: 1440 },
  { label: "1 week", min: 10080 },
];
const WORK = [
  { label: "15 minutes", min: 15 },
  { label: "1 hour", min: 60 },
  { label: "1 day", min: 1440 },
  { label: "1 week", min: 10080 },
  { label: "30 days", min: 43200 },
];

function Choice({ name, options, value, onChange }: { name: string; options: { label: string; min: number }[]; value: number; onChange: (m: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.min}
          type="button"
          role="radio"
          aria-checked={value === o.min}
          onClick={() => onChange(o.min)}
          className={`rounded-full px-4 py-2 font-display text-sm font-semibold ${value === o.min ? "bg-fg text-ink" : "bg-panel text-fg hover:bg-line"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const DRAFT_KEY = "cashcow.draftTask";

export default function StartMarket() {
  const router = useRouter();
  const { account } = useWallet();
  const [task, setTask] = useState("");
  const [github, setGithub] = useState<string | null>(null);
  const [stake, setStake] = useState(10);
  const [join, setJoin] = useState(60);
  const [work, setWork] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Connecting GitHub leaves this page and comes back, so keep the draft task across that round trip.
  useEffect(() => {
    try {
      const d = sessionStorage.getItem(DRAFT_KEY);
      if (d) setTask(d);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, task);
    } catch {}
  }, [task]);

  async function onCreate() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      // The on-chain round only records your task for the referee. Its entry is the smallest token unit (refunded);
      // your real stake is the bond posted on the next step, kept apart from the bets.
      const now = Math.floor(Date.now() / 1000);
      const stakeDeadline = now + join * 60;
      const { receipts } = await send(calls.createCohort(GROUP_TAG, stakeDeadline, stakeDeadline + work * 60, MARKET_ENTRY));
      const id = receipts.length ? createdCohortId(receipts) : 1;
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {}
      router.push(`/stake?cohort=${id}&bond=${stake}&task=${encodeURIComponent(task.trim())}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const stakeOk = Number.isFinite(stake) && stake >= 1 && stake <= 100;
  const taskOk = task.trim().length >= 8;

  return (
    <div className="max-w-2xl space-y-10">
      <header>
        <Link href="/cohorts" className="label hover:text-fg">← Markets</Link>
        <h1 className="display text-6xl sm:text-7xl">Create a market on yourself.</h1>
        <p className="mt-4 text-lg text-fg/80">
          Say what you will get done, put your own stake behind it, and send the link. Friends bet YES or NO on whether you finish.
          Finish and you get exactly your stake back. Miss it and your stake goes to the people who bet NO.
        </p>
      </header>

      <div className="space-y-8">
        <div>
          <label className="label" htmlFor="task">Your task</label>
          <textarea id="task" className="input min-h-28 text-lg" placeholder="Push 2 commits adding a dark mode toggle to alice/portfolio on main" value={task} onChange={(e) => setTask(e.target.value)} />
          <p className="mt-2 text-sm text-muted">For now, tasks are commits to a public GitHub repo you can push to.</p>
        </div>
        {account && (
          <div>
            <div className="label">Your GitHub</div>
            <GithubConnect returnPath="/cohorts/new" onChange={setGithub} />
          </div>
        )}
        <div>
          <label className="label" htmlFor="stake">Your stake (AUSD)</label>
          <input
            id="stake"
            type="number"
            min={1}
            max={100}
            className="input max-w-[10rem] text-lg"
            value={Number.isFinite(stake) ? stake : ""}
            onChange={(e) => setStake(Number(e.target.value))}
          />
          {!stakeOk && <p className="mt-2 text-sm text-fail">Choose 1 to 100 AUSD.</p>}
        </div>
        <div>
          <div className="label">Betting stays open for</div>
          <Choice name="Joining window" options={JOIN} value={join} onChange={setJoin} />
        </div>
        <div>
          <div className="label">Then you have this long to finish</div>
          <Choice name="Time to finish" options={WORK} value={work} onChange={setWork} />
        </div>
      </div>

      <ErrorBox msg={err} />

      <div className="flex flex-wrap items-center gap-4">
        {account ? (
          <>
            <button type="button" className="btn-primary" disabled={!stakeOk || !taskOk || !github || busy} onClick={onCreate}>
              {busy ? <><Spinner /> Creating on-chain…</> : "Next: check my task"}
            </button>
            <span className="text-sm text-muted">Next you confirm the exact criteria and your stake. You can't bet on your own market.</span>
          </>
        ) : (
          <div className="w-full max-w-sm">
            <div className="label">Connect a wallet to create a market</div>
            <ConnectOptions />
          </div>
        )}
      </div>
    </div>
  );
}
