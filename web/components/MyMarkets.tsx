"use client";
import Link from "next/link";
import { getMyMarkets, type MyMarket } from "@/lib/api";
import { countdown, useNow, usePoll } from "@/lib/time";
import { fmtAmount, useWallet } from "@/lib/wallet";
import { ErrorBox, Spinner } from "./ui";
import { ConnectOptions } from "./Wallet";
import { useLiveMarket } from "./useLiveMarket";

const STAKE_RESULT: Record<MyMarket["stakeResult"], string> = {
  pending: "held until the verdict",
  returned: "returned to you",
  to_no: "went to the NO bettors",
  burned: "burned (nobody bet NO)",
};

function phase(c: MyMarket["cohort"], now: number) {
  if (c.stake_deadline * 1000 > now) return `betting closes in ${countdown(c.stake_deadline, now)}`;
  if (c.goal_deadline * 1000 > now) return `deadline in ${countdown(c.goal_deadline, now)}`;
  return c.settled ? "paid out" : "judging";
}

function Row({ m, now }: { m: MyMarket; now: number }) {
  const live = useLiveMarket(m.cohort.id, 6);
  return (
    <li>
      <Link href={live.href} className="flex flex-wrap items-center gap-x-6 gap-y-1 py-4 hover:text-nose-deep">
        <span className="display w-16 shrink-0 text-3xl">#{m.cohort.id}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg font-semibold">{live.title}</span>
          <span className="num text-sm text-muted">
            {live.bets ? `${live.bets} · ` : ""}
            {phase(m.cohort, now)}
          </span>
        </span>
        <span className="num text-right text-sm">
          {fmtAmount(m.stake, 6)} AUSD staked
          <span className="block text-muted">{STAKE_RESULT[m.stakeResult]}</span>
        </span>
      </Link>
    </li>
  );
}

/** The solo stake page: every market this wallet created. Creators stake on themselves; others bet. */
export function MyMarkets() {
  const { account } = useWallet();
  const now = useNow();
  const { data, error } = usePoll(
    () => (account ? getMyMarkets(account.address) : Promise.resolve(null)),
    15_000,
    [account?.address],
  );

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="label">Solo stake</div>
          <h1 className="display text-6xl sm:text-8xl">Your markets.</h1>
          <p className="mt-4 max-w-2xl text-lg text-fg/80">
            Bet on yourself: put a task up with your own stake. It's a public market, so others can bet YES or NO on you, but you
            can't bet on it yourself. Finish and you get your stake back. Miss it and your stake goes to the people who bet NO.
          </p>
        </div>
        <Link href="/cohorts/new" className="btn-primary">Create a market</Link>
      </header>

      {!account ? (
        <div className="max-w-sm">
          <div className="label">Connect a wallet to see your markets</div>
          <ConnectOptions />
        </div>
      ) : (
        <section>
          <ErrorBox msg={error && !data ? error : null} />
          {!data && !error && <Spinner />}
          {data && data.length === 0 && (
            <div className="card flex flex-wrap items-center justify-between gap-4">
              <p className="text-fg/80">You haven't created a market yet.</p>
              <Link href="/cohorts/new" className="btn-ghost">Create one</Link>
            </div>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {data.map((m) => (
                <Row key={m.cohort.id} m={m} now={now} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
