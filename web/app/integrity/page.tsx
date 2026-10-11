"use client";
import { getAttacks } from "@/lib/api";
import { usePoll } from "@/lib/time";
import type { Attack } from "@/lib/types";
import { ATTACK_LABEL } from "@/lib/types";
import { Stat } from "@/components/ui";
import { fmtTime } from "@/lib/time";
// Contract-level red-team run (redteam/, Agent A), committed with the repo and read at build time.
import onchain from "@redteam/results/onchain.json";

type OnchainResult = { category: string; attack: string; outcome: string; detail: string };
const CONTRACT_TESTS = (onchain.results as OnchainResult[]).filter((r) => r.outcome !== "skipped");

// Each safeguard and the cheat it shuts down. Copy is factual: it describes what the referee does today.
const SAFEGUARDS: [string, string, string][] = [
  [
    "It gathers the evidence itself",
    "Uploads, screenshots and claimed timestamps are never accepted. The referee reads your repo, page or submission directly.",
    "Faked proof",
  ],
  [
    "It only counts what it saw happen",
    "Each commit is timed by when the referee first saw it, not by its author date. Work that existed before you staked does not count.",
    "Backdated or old work",
  ],
  [
    "You prove the work is yours",
    "Before the deadline you add a one-time code to the repo or page. Pointing at someone else's work fails this check.",
    "Borrowed work",
  ],
  [
    "It checks substance, not activity",
    "Two independent models must agree that the work actually delivers the task. If they disagree, a person reviews it and the override is shown publicly.",
    "Filler commits, placeholder pages",
  ],
  [
    "It cannot be talked into a pass",
    "Everything it reads is treated as data, never as instructions, and model output that does not fit the expected format fails closed.",
    "Hidden instructions to the AI",
  ],
  [
    "Every ruling can be checked",
    "The full verdict is hashed and posted on-chain. Your browser recomputes the hash and compares, so a ruling cannot be quietly changed later.",
    "Edited or invented verdicts",
  ],
  [
    "Nobody can take the money",
    "The contract has no owner withdrawal. If no verdict is posted, everyone is refunded.",
    "Operator or referee profiting",
  ],
];

export default function IntegrityPage() {
  const { data } = usePoll<Attack[]>(getAttacks, 15_000);
  const tests = data ?? [];
  const contractCaught = CONTRACT_TESTS.filter((r) => r.outcome === "caught").length;
  const caught = tests.filter((a) => a.outcome === "caught").length + contractCaught;
  const missed = tests.filter((a) => a.outcome === "fooled").length + CONTRACT_TESTS.filter((r) => r.outcome === "fooled").length;

  const byCat = new Map<string, { caught: number; missed: number }>();
  for (const a of tests) {
    if (!a.outcome) continue;
    const row = byCat.get(a.category) ?? { caught: 0, missed: 0 };
    row[a.outcome === "caught" ? "caught" : "missed"]++;
    byCat.set(a.category, row);
  }

  return (
    <div className="grid gap-y-14 lg:grid-cols-12 lg:gap-x-12">
      <header className="lg:col-span-8">
        <div className="label">Integrity</div>
        <h1 className="display text-6xl sm:text-8xl">How the referee stays fair.</h1>
        <p className="mt-6 max-w-xl text-lg text-fg/80">
          A stake only means something if nobody can pass without doing the work. These safeguards run on every task.
        </p>
      </header>

      <section className="lg:col-span-12">
        <ol className="border-t border-line">
          {SAFEGUARDS.map(([title, body, stops], i) => (
            <li key={title} className="grid gap-x-6 gap-y-1 border-b border-line py-6 sm:grid-cols-[3rem_1fr_14rem]">
              <span className="num text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="font-display text-xl font-bold tracking-tight">{title}</div>
                <p className="mt-1 max-w-2xl text-fg/70">{body}</p>
              </div>
              <div className="sm:text-right">
                <span className="label !mb-0">Stops</span>
                <span className="text-sm">{stops}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {(tests.length > 0 || CONTRACT_TESTS.length > 0) && (
        <section className="lg:col-span-12">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="label">Adversarial testing</div>
              <p className="max-w-md text-fg/80">
                We attack the referee ourselves with scripted cheats. Results are published as they are, including any it
                missed.
              </p>
              <div className="mt-8 grid grid-cols-2">
                <Stat label="Caught" value={caught} tone="text-pass" />
                <Stat label="Missed" value={missed} tone={missed ? "text-fail" : undefined} />
              </div>
            </div>
            {byCat.size > 0 && (
              <table className="w-full self-start text-sm lg:col-span-6 lg:col-start-7">
                <thead>
                  <tr className="label text-left [&>th]:pb-2 [&>th]:font-normal">
                    <th>Attack on the referee</th>
                    <th className="text-right">Caught</th>
                    <th className="text-right">Missed</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {[...byCat.entries()].map(([cat, r]) => (
                    <tr key={cat} className="border-t border-line [&>td]:py-2.5">
                      <td className="font-sans">{ATTACK_LABEL[cat] ?? cat.replace(/_/g, " ")}</td>
                      <td className="text-right text-pass">{r.caught}</td>
                      <td className={`text-right ${r.missed ? "text-fail" : "text-muted"}`}>{r.missed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {CONTRACT_TESTS.length > 0 && (
            <div className="mt-12">
              <div className="label">Attacks on the contract · run {fmtTime(onchain.ran_at)}</div>
              <ul className="border-t border-line text-sm">
                {CONTRACT_TESTS.map((r, i) => (
                  <li key={i} className="grid grid-cols-[1fr_auto] gap-x-6 border-b border-line py-3 sm:grid-cols-[1fr_14rem_5rem]">
                    <span>{r.attack}</span>
                    <span className="num col-span-2 row-start-2 text-xs text-muted sm:col-span-1 sm:row-start-auto">{r.detail}</span>
                    <span className={`num text-right text-xs uppercase tracking-[0.14em] ${r.outcome === "caught" ? "text-pass" : "text-fail"}`}>
                      {r.outcome === "caught" ? "caught" : "missed"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
