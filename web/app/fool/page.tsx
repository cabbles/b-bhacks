"use client";
import Link from "next/link";
import { getAttacks } from "@/lib/api";
import { fmtTime, usePoll } from "@/lib/time";
import { ATTACK_LABEL, type Attack } from "@/lib/types";
import { ErrorBox, Spinner, Stat } from "@/components/ui";
import DecryptedText from "@/components/reactbits/DecryptedText";
import ClickSpark from "@/components/reactbits/ClickSpark";

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
    <div className="grid gap-y-12 lg:grid-cols-12 lg:gap-x-12">
      <header className="lg:col-span-7">
        <div className="label">Public record · every attempt, including the ones that worked</div>
        <h1 className="display text-[19vw] sm:text-9xl">
          <DecryptedText text="Fool" animateOn="view" sequential speed={45} />
          <br />
          <span className="text-muted">the</span> <DecryptedText text="Ref." animateOn="view" sequential speed={45} />
        </h1>
        <p className="mt-6 max-w-md text-lg text-fg/80">
          Try to get an unfinished goal approved. Declare it when you stake. The referee never sees the flag.
        </p>
        <div className="mt-8 inline-block">
          <ClickSpark sparkColor="#FF5A4E" sparkCount={12}>
            <Link href="/stake" className="btn-primary">Try to cheat →</Link>
          </ClickSpark>
        </div>
      </header>

      <aside className="space-y-10 lg:col-span-5 lg:pt-10">
        <div className="grid grid-cols-3">
          <Stat label="Caught" value={caught} tone="text-pass" />
          <Stat label="Fooled" value={fooled} tone="text-fail" />
          <Stat label="Pending" value={pending} />
        </div>

        {byCat.size > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="label text-left [&>th]:pb-2 [&>th]:font-normal">
                <th>Category</th>
                <th className="text-right">Caught</th>
                <th className="text-right">Fooled</th>
                <th className="text-right">Pending</th>
              </tr>
            </thead>
            <tbody className="num">
              {[...byCat.entries()].map(([cat, r]) => (
                <tr key={cat} className="border-t border-line [&>td]:py-2.5">
                  <td className="font-sans">{ATTACK_LABEL[cat] ?? cat.replace(/_/g, " ")}</td>
                  <td className="text-right text-pass">{r.caught}</td>
                  <td className="text-right text-fail">{r.fooled}</td>
                  <td className="text-right text-muted">{r.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </aside>

      <section className="lg:col-span-12">
        <div className="label">Log</div>
        <ul className="border-t border-line">
          {data.length === 0 && <li className="py-4 text-muted">No attempts yet.</li>}
          {[...data].reverse().map((a) => (
            <li key={a.goal_id}>
              <Link href={`/goals/${a.goal_id}`} className="grid grid-cols-[1fr_auto] gap-x-6 border-b border-line py-4 hover:bg-panel sm:grid-cols-[12rem_1fr_auto]">
                <span className="label !mb-0 self-center">{ATTACK_LABEL[a.category] ?? a.category.replace(/_/g, " ")}</span>
                <span className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  {a.note || <span className="text-muted">No note</span>}
                  {a.decided_at && <span className="num ml-2 text-xs text-muted">{fmtTime(a.decided_at)}</span>}
                </span>
                <span
                  className={`num self-center text-xs uppercase tracking-[0.14em] ${a.outcome === "caught" ? "text-pass" : a.outcome === "fooled" ? "text-fail" : "text-muted"}`}
                >
                  {a.outcome ?? "pending"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
