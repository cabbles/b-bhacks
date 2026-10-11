"use client";
import Link from "next/link";
import { getAttacks } from "@/lib/api";
import { fmtTime, usePoll } from "@/lib/time";
import type { Attack } from "@/lib/types";
import { ErrorBox, Spinner, Stat } from "@/components/ui";

export default function FoolBoard() {
  const { data, error } = usePoll<Attack[]>(getAttacks, 8_000);
  if (error && !data) return <ErrorBox msg={error} />;
  if (!data) return <Spinner />;

  const caught = data.filter((a) => a.outcome === "caught").length;
  const fooled = data.filter((a) => a.outcome === "fooled").length;
  const pending = data.length - caught - fooled;

  const byCat = new Map<string, { caught: number; fooled: number; pending: number }>();
  for (const a of data) {
    const row = byCat.get(a.category) ?? { caught: 0, fooled: 0, pending: 0 };
    row[a.outcome ?? "pending"]++;
    byCat.set(a.category, row);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black">😈 Fool the Ref</h1>
        <p className="mt-2 text-zinc-300">
          Anyone can try to get an unfinished goal approved. Every attempt is public, including the ones that worked.
        </p>
        <Link href="/stake" className="btn-primary mt-3">Try to cheat</Link>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Caught" value={<span className="text-green-400">{caught}</span>} />
        <Stat label="Fooled" value={<span className="text-red-400">{fooled}</span>} />
        <Stat label="Pending" value={pending} />
      </div>

      {byCat.size > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr><th className="pb-2">Category</th><th className="pb-2 text-right">Caught</th><th className="pb-2 text-right">Fooled</th><th className="pb-2 text-right">Pending</th></tr>
            </thead>
            <tbody>
              {[...byCat.entries()].map(([cat, r]) => (
                <tr key={cat} className="border-t border-zinc-800">
                  <td className="py-2">{cat.replace(/_/g, " ")}</td>
                  <td className="py-2 text-right text-green-400">{r.caught}</td>
                  <td className="py-2 text-right text-red-400">{r.fooled}</td>
                  <td className="py-2 text-right">{r.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="space-y-2">
        {data.length === 0 && <li className="text-zinc-400">No attempts yet.</li>}
        {[...data].reverse().map((a) => (
          <li key={a.goal_id}>
            <Link href={`/goals/${a.goal_id}`} className="card flex items-start gap-3 hover:border-zinc-600">
              <span className="text-2xl">{a.outcome === "caught" ? "🛡️" : a.outcome === "fooled" ? "🎭" : "⏳"}</span>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-zinc-400">{a.category.replace(/_/g, " ")}</div>
                <div>{a.note || <span className="text-zinc-500">No note</span>}</div>
                {a.decided_at && <div className="text-xs text-zinc-500">decided {fmtTime(a.decided_at)}</div>}
              </div>
              <span className={`font-bold ${a.outcome === "caught" ? "text-green-400" : a.outcome === "fooled" ? "text-red-400" : "text-zinc-400"}`}>
                {a.outcome ?? "pending"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
