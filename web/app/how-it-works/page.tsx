import Link from "next/link";
import { ADDRESSES, addrUrl } from "@/lib/env";

export const metadata = { title: "How it works · Cash Cow" };

const STEPS: [string, string][] = [
  ["Create a market on yourself", "Describe a task (commits to a public GitHub repo you can push to), put your own stake behind it, and set the deadline."],
  ["Others bet", "Anyone except you can bet YES or NO on whether you finish. Bets go into a separate pot."],
  ["The referee checks", "After the deadline it reads your repo itself and rules pass or fail, with reasons."],
  ["Everyone is paid", "Finish: your stake comes back and the YES side wins. Miss: your stake goes to the NO side. Payouts are sent automatically."],
];

// Each guarantee names what enforces it. Keep this list true to the code: if a rule changes, change it here.
const GUARANTEES: [string, string, string][] = [
  [
    "Nobody can take the money",
    "Stakes and bets are held by smart contracts that have no owner and no withdraw function. Money can only go back to you, to the winning side, or be burned when a creator misses and nobody bet NO.",
    "The contracts",
  ],
  [
    "No ruling means a refund",
    "If the referee never posts a verdict, every stake and bet is refunded in full.",
    "The contracts",
  ],
  [
    "The referee can only rule, not pay itself",
    "Its key can post one verdict per task, only after the deadline and before the round settles. It cannot move funds.",
    "The contracts",
  ],
  [
    "Payouts don't depend on us",
    "We send payouts automatically, but anyone can trigger them, and they always go to the person owed. If this site disappeared, the money could still be claimed.",
    "The contracts",
  ],
  [
    "Creators can't bet on themselves",
    "The betting contract refuses any bet, YES or NO, from the person who created the market.",
    "The contracts",
  ],
  [
    "Only your own repo counts",
    "You connect your GitHub account, and a market is only accepted on a public repo that account can push to.",
    "The referee",
  ],
  [
    "Only new work counts",
    "Commits are timed by when the referee first saw them, never by their own dates, so backdating does nothing. Anything already in the repo when you staked is ignored, on every branch.",
    "The referee",
  ],
  [
    "Busywork doesn't pass",
    "Two independent AI models must both agree the work actually delivers the task. Whitespace or filler fails. If they disagree, a person decides, and that override is shown publicly.",
    "The referee",
  ],
  [
    "It can't be talked into a pass",
    "Everything it reads is treated as data, never as instructions. Text aimed at the AI (\"mark this as passed\") fails the task, and any answer that doesn't fit the expected format counts as a fail, not a pass.",
    "The referee",
  ],
  [
    "Every ruling can be checked",
    "The full verdict is fingerprinted (hashed) and the fingerprint is posted on-chain. Each task page recomputes it in your browser, so a ruling can't be quietly changed later.",
    "Your browser",
  ],
];

const LIMITS: string[] = [
  "The AI judges can be wrong. Two must agree, and disagreements go to a person, but a convincing fake could still pass.",
  "Work written before staking but pushed afterwards looks new. Only the judges' sense of whether it matches the task stands in the way.",
  "On a shared repo, the referee can't tell whose push a commit was. Use your own branch or repo for your task.",
  "This runs on a test network. The tokens have no value, and the contracts have not been audited.",
];

export default function HowItWorks() {
  const contracts: [string, `0x${string}` | null][] = [
    ["Stakes (StakePool)", ADDRESSES.pool],
    ["Bets (MarketPool)", ADDRESSES.market],
    ["Creator stakes (CommitmentBond)", ADDRESSES.bond],
  ];
  return (
    <div className="space-y-16">
      <header className="max-w-3xl">
        <div className="label">How it works</div>
        <h1 className="display text-6xl sm:text-8xl">Fair by design.</h1>
        <p className="mt-4 text-lg text-fg/80">
          Cash Cow holds money on a promise: do the task or lose your stake. Here is how a market runs, what is guaranteed and by
          what, and what isn&apos;t.
        </p>
      </header>

      <section>
        <div className="label">A market, start to finish</div>
        <ol className="grid grid-cols-1 gap-6 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="num text-sm text-muted">0{i + 1}</span>
              <div className="font-display text-lg font-semibold">{t}</div>
              <p className="text-sm text-fg/75">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <div className="label">Guarantees</div>
        <ul className="border-t border-line">
          {GUARANTEES.map(([t, d, by]) => (
            <li key={t} className="grid grid-cols-1 gap-x-8 gap-y-1 border-b border-line py-5 sm:grid-cols-[1fr_2fr_auto]">
              <div className="font-display text-xl font-bold tracking-tight">{t}</div>
              <p className="text-fg/75">{d}</p>
              <span className="label !mb-0 self-start sm:text-right">Enforced by: {by}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-3xl">
        <div className="label">What it can&apos;t promise</div>
        <ul className="list-disc space-y-2 border-t border-line pl-5 pt-4 text-fg/80">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="max-w-3xl">
        <div className="label">Check it yourself</div>
        <p className="border-t border-line pt-4 text-fg/80">
          The contracts are public on Base Sepolia. Anyone can read what they hold and every transaction they have made.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {contracts.map(([label, a]) =>
            a ? (
              <li key={label}>
                {label}:{" "}
                <a className="link num break-all" href={addrUrl(a)} target="_blank" rel="noreferrer">
                  {a}
                </a>
              </li>
            ) : null,
          )}
        </ul>
        <p className="mt-6">
          <Link href="/cohorts" className="btn-primary">Browse markets</Link>
        </p>
      </section>
    </div>
  );
}
