import type { GoalStatus } from "@/lib/types";
import CountUp from "@/components/reactbits/CountUp";
import { txUrl } from "@/lib/env";
import { short } from "@/lib/time";

const STATUS: Record<GoalStatus, { label: string; cls: string }> = {
  watching: { label: "Watching", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  passed: { label: "Passed", cls: "bg-green-500/15 text-green-300 border-green-500/30" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  needs_human: { label: "Needs human", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

export function StatusPill({ status, big }: { status: GoalStatus; big?: boolean }) {
  const s = STATUS[status] ?? STATUS.watching;
  return (
    <span className={`inline-flex items-center rounded-full border font-semibold ${s.cls} ${big ? "px-4 py-1.5 text-lg" : "px-2.5 py-0.5 text-xs"}`}>
      {s.label}
    </span>
  );
}

export function TxLink({ hash, label }: { hash?: string | null; label: string }) {
  if (!hash) return <span className="text-zinc-500">{label}: pending</span>;
  return (
    <a className="link" href={txUrl(hash)} target="_blank" rel="noreferrer">
      {label}: <span className="font-mono">{short(hash, 6)}</span> ↗
    </a>
  );
}

export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{msg}</div>;
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]" />;
}

export function Stat({ label, value, tone }: { label: string; value: number | React.ReactNode; tone?: string }) {
  return (
    <div className="card text-center backdrop-blur">
      <div className={`text-2xl font-black tabular-nums sm:text-3xl ${tone ?? ""}`}>
        {typeof value === "number" ? <CountUp to={value} duration={1} /> : value}
      </div>
      <div className="text-xs uppercase tracking-wider text-zinc-400">{label}</div>
    </div>
  );
}
