"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createMarket } from "@/lib/api";
import { ErrorBox, Spinner } from "@/components/ui";

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

export default function StartMarket() {
  const router = useRouter();
  const [task, setTask] = useState("");
  const [stake, setStake] = useState(10);
  const [join, setJoin] = useState(60);
  const [work, setWork] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onCreate() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      // The round only holds you; its 1 AUSD entry is refunded. Your real stake is the bond posted next.
      const m = await createMarket({ stake: 1, stake_minutes: join, goal_minutes: work });
      router.push(`/stake?cohort=${m.id}&bond=${stake}&task=${encodeURIComponent(task.trim())}`);
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
        </div>
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
        <button type="button" className="btn-primary" disabled={!stakeOk || !taskOk || busy} onClick={onCreate}>
          {busy ? <><Spinner /> Creating on-chain…</> : "Next: check my task"}
        </button>
        <span className="text-sm text-muted">No gas needed. Next you confirm the exact criteria and sign your stake (plus a 1 AUSD entry, refunded).</span>
      </div>
    </div>
  );
}
