import type { GoalStatus } from "@/lib/types";
import { txUrl } from "@/lib/env";
import { short } from "@/lib/time";
import CountUp from "@/components/reactbits/CountUp";

const STATUS: Record<GoalStatus, { label: string; cls: string }> = {
  watching: { label: "Watching", cls: "border-fg/40 text-fg" },
  passed: { label: "Passed", cls: "border-pass bg-pass text-ink" },
  failed: { label: "Failed", cls: "border-fail text-fail" },
  needs_human: { label: "Needs human", cls: "border-human text-human" },
};

export function StatusPill({ status, big }: { status: GoalStatus; big?: boolean }) {
  const s = STATUS[status] ?? STATUS.watching;
  return (
    <span
      className={`inline-flex items-center border font-mono uppercase tracking-[0.14em] ${s.cls} ${big ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[10px]"}`}
    >
      {s.label}
    </span>
  );
}

export function TxLink({ hash, label }: { hash?: string | null; label: string }) {
  if (!hash) return <span className="text-muted">{label}: pending</span>;
  return (
    <a className="link" href={txUrl(hash)} target="_blank" rel="noreferrer">
      {label} <span className="num">{short(hash, 6)}</span> ↗
    </a>
  );
}

export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="border-l-2 border-fail bg-fail/10 px-3 py-2 text-sm text-fail">{msg}</div>;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <div className="border-l-2 border-human bg-human/10 px-3 py-2 text-sm text-human">{children}</div>;
}

export function Spinner() {
  return <span className="inline-block h-3 w-3 animate-spin border-2 border-current border-t-transparent align-[-1px]" />;
}

/** Scoreboard figure: big mono number over a small label, separated by hairlines, not boxed. */
export function Stat({ label, value, tone }: { label: string; value: number | React.ReactNode; tone?: string }) {
  return (
    <div className="border-l border-line pl-3">
      <div className={`num text-3xl font-semibold sm:text-5xl ${tone ?? ""}`}>
        {typeof value === "number" ? <CountUp to={value} duration={1} /> : value}
      </div>
      <div className="label mt-1">{label}</div>
    </div>
  );
}
