"use client";
import { getBond, getCohort, getPredictionMarket } from "@/lib/api";
import { usePoll } from "@/lib/time";
import { fmtAmount } from "@/lib/wallet";

/** Live task, YES/NO totals, and the owner's stake for one market. */
export function useLiveMarket(cohortId: number, dec: number) {
  const { data: board, error } = usePoll(() => getCohort(cohortId), 12_000, [cohortId]);
  const goal = board?.goals?.[0];
  const owner = (goal?.staker ?? "") as `0x${string}` | "";
  const { data: market } = usePoll(
    () => (owner ? getPredictionMarket(cohortId, owner, owner).catch(() => null) : Promise.resolve(null)),
    8_000,
    [cohortId, owner],
  );
  const { data: bond } = usePoll(
    () => (owner ? getBond(cohortId, owner).catch(() => null) : Promise.resolve(null)),
    12_000,
    [cohortId, owner],
  );

  const href = goal ? `/goals/${goal.goal_id}` : `/cohorts/${cohortId}`;
  const title = error
    ? "Could not load this market"
    : !board
      ? "Loading the task…"
      : goal?.goal_text?.trim() || (goal ? "Task is live" : "Waiting for the owner to confirm the task");

  let bets: string | null = null;
  if (market) {
    const stake = bond && bond.amount !== "0" ? `${fmtAmount(bond.amount, dec)} AUSD owner stake · ` : "";
    bets = `${stake}${fmtAmount(market.yes_total, dec)} YES · ${fmtAmount(market.no_total, dec)} NO`;
  } else if (goal) {
    bets = "Loading bets…";
  }

  return { href, title, bets, owner: owner as `0x${string}` | "" };
}
