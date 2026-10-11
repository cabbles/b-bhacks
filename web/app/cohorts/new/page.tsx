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
      const m = await createMarket({ stake: stake, stake_minutes: join, goal_minutes: work });
      router.push(`/cohorts/${m.id}?created=1`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const stakeOk = Number.isFinite(stake) && stake >= 1 && stake <= 100;

  return (
    <div className="max-w-2xl space-y-10">
      <header>
        <Link href="/cohorts" className="label hover:text-fg">← Group markets</Link>
        <h1 className="display text-6xl sm:text-7xl">Start a group market.</h1>
        <p className="mt-4 text-lg text-fg/80">
          Set the stake and the clock, then send the link to whoever you want in it. Everyone who joins commits to their own task
          by the same deadline. Whoever finishes splits the stakes of whoever does not.
        </p>
      </header>

      <div className="space-y-8">
        <div>
          <label className="label" htmlFor="stake">Stake per person (AUSD)</label>
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
          <div className="label">People can join for</div>
          <Choice name="Joining window" options={JOIN} value={join} onChange={setJoin} />
        </div>
        <div>
          <div className="label">Then everyone has this long to finish</div>
          <Choice name="Time to finish" options={WORK} value={work} onChange={setWork} />
        </div>
      </div>

      <ErrorBox msg={err} />

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn-primary" disabled={!stakeOk || busy} onClick={onCreate}>
          {busy ? <><Spinner /> Creating on-chain…</> : "Create market"}
        </button>
        <span className="text-sm text-muted">Free: the relayer pays the gas. Takes a few seconds.</span>
      </div>
    </div>
  );
}
