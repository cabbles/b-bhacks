"use client";
import { useRef, useState } from "react";
import { parseUnits } from "viem";
import { getConfig, getPredictionMarket, relayBet, resolvePredictionMarket, claimPredictionMarket } from "@/lib/api";
import { signBetAuthorization } from "@/lib/erc3009";
import { MOCK, addrUrl } from "@/lib/env";
import { fmtAmount, tokenBalance, useWallet } from "@/lib/wallet";
import { countdown, fmtTime, short, useNow, usePoll } from "@/lib/time";
import type { RelayerConfig } from "@/lib/types";
import { ErrorBox, Spinner, TxLink } from "./ui";

type Props = { cohortId: number; owner: `0x${string}` };
export function PredictionMarket(props: Props) {
  const { data: cfg } = usePoll(getConfig, 30_000);
  // Old relayers and fixture mode remain usable until MarketPool is actually deployed.
  if (MOCK || !cfg?.market_pool) return null;
  return <LiveMarket key={`${props.cohortId}:${props.owner}:${cfg.market_pool}`} {...props} cfg={cfg} />;
}

function LiveMarket({ cohortId, owner, cfg }: Props & { cfg: RelayerConfig }) {
  const { account, dripState, retryDrip } = useWallet();
  const now = useNow();
  const [version, refresh] = useState(0);
  const [side, setSide] = useState(true);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const dec = cfg.decimals ?? 6;
  const { data, error: readError } = usePoll(async () => {
    if (!account) return null;
    const [market, balance] = await Promise.all([
      getPredictionMarket(cohortId, owner, account.address), tokenBalance(cfg.token, account.address),
    ]);
    if (market.address.toLowerCase() !== cfg.market_pool?.toLowerCase()) throw new Error("Market configuration changed. Reload before betting.");
    return { market, balance };
  }, 5000, [account?.address, cohortId, owner, version]);
  const m = data?.market;
  const ownerWallet = account?.address.toLowerCase() === owner.toLowerCase();
  const selectedYes = ownerWallet || side;
  let raw = 0n;
  if (new RegExp(`^\\d+(?:\\.\\d{1,${dec}})?$`).test(amount)) {
    try { raw = parseUnits(amount, dec); } catch {}
  }
  const open = !!m && m.result === 0 && !m.settled && now < m.betting_deadline * 1000;
  const insufficient = data?.balance !== null && data?.balance !== undefined && raw > data.balance;
  const canBet = open && !!account && !readError && raw > 0n && data?.balance != null && !insufficient && !busy;

  async function transact(action: "bet" | "resolve" | "claim") {
    if (!account || !m || locked.current) return;
    locked.current = true; setBusy(true); setError(null); setTx(null);
    try {
      let result;
      if (action === "bet") {
        if (!canBet) throw new Error("Check the amount, balance and betting deadline.");
        const authorization = await signBetAuthorization(account, cfg, {
          pool: cfg.market_pool!, cohortId, owner, yes: selectedYes, value: raw,
          sequence: BigInt(m.sequence), deadline: m.betting_deadline,
        });
        result = await relayBet({ cohort_id: cohortId, owner, bettor: account.address, yes: selectedYes, amount: String(raw), authorization });
      } else if (action === "resolve") result = await resolvePredictionMarket(cohortId, owner);
      else result = await claimPredictionMarket(cohortId, owner, account.address);
      setTx(result.tx_hash);
    } catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(false); refresh((v) => v + 1); }
  }

  return (
    <section className="space-y-5 border-t border-line pt-6" aria-label="YES/NO betting">
      <div>
        <div className="label">Public YES / NO market</div>
        <h2 className="font-display text-2xl font-bold">Will this task pass?</h2>
        <p className="mt-2 text-sm text-muted">A separate pot of test AUSD. The owner’s commitment stake stays untouched.</p>
      </div>
      <ErrorBox msg={error || readError} />
      {!m ? <Spinner /> : <>
        <dl className="grid grid-cols-2 gap-4 border-y border-line py-4">
          <div><dt className="label text-pass">YES</dt><dd className="num text-2xl">{fmtAmount(m.yes_total, dec)} <span className="text-xs text-muted">AUSD</span></dd></div>
          <div><dt className="label text-fail">NO</dt><dd className="num text-2xl">{fmtAmount(m.no_total, dec)} <span className="text-xs text-muted">AUSD</span></dd></div>
        </dl>
        <p className="text-sm">{open ? `Betting closes in ${countdown(m.betting_deadline, now)}` : m.result === 1 ? "Resolved: YES wins" : m.result === 2 ? "Resolved: NO wins" : m.result === 3 ? "Resolved: bets refunded" : "Betting closed. Waiting for settlement."}</p>
        {open && <form onSubmit={(e) => { e.preventDefault(); void transact("bet"); }} className="space-y-4">
          <fieldset disabled={busy}>
            <legend className="label">Choose a side</legend>
            <div className="flex gap-3">
              <button type="button" aria-pressed={selectedYes} onClick={() => setSide(true)} className={selectedYes ? "btn-primary flex-1" : "btn-ghost flex-1"}>YES</button>
              <button type="button" aria-pressed={!selectedYes} disabled={ownerWallet} onClick={() => setSide(false)} className={!selectedYes ? "btn-primary flex-1" : "btn-ghost flex-1"}>NO</button>
            </div>
          </fieldset>
          {ownerWallet && <p className="text-xs text-muted">This is your task. Your wallet can only bet YES.</p>}
          <label className="block text-sm" htmlFor={`bet-${cohortId}-${owner}`}>Bet amount (test AUSD)</label>
          <input id={`bet-${cohortId}-${owner}`} className="input" inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
          <p className="num text-xs text-muted">Wallet {account ? short(account.address) : "loading"} · Balance {data?.balance == null ? "unavailable" : `${fmtAmount(data.balance, dec)} AUSD`}</p>
          {insufficient && <p className="text-sm text-fail">Not enough test AUSD for this bet.</p>}
          {dripState === "error" && <button type="button" className="btn-ghost" onClick={retryDrip}>Retry test AUSD faucet</button>}
          <button type="submit" className="btn-primary w-full" disabled={!canBet}>{busy ? "Confirming…" : `Place ${selectedYes ? "YES" : "NO"} bet`}</button>
        </form>}
        <div className="space-y-2 text-sm">
          <div className="label">Your bets</div>
          <p className="num">YES {fmtAmount(m.yes_amount, dec)} · NO {fmtAmount(m.no_amount, dec)} AUSD</p>
          {m.claimed ? <p className="text-pass">Payout received.</p> : BigInt(m.claimable) > 0n ? <>
            <p>{fmtAmount(m.claimable, dec)} AUSD ready to claim.</p>
            <button className="btn-primary w-full" disabled={busy || !!readError} onClick={() => void transact("claim")}>{busy ? "Confirming…" : m.result === 3 ? "Claim refund" : "Claim betting payout"}</button>
          </> : m.result > 0 && BigInt(m.yes_amount) + BigInt(m.no_amount) > 0n ? <p className="text-muted">No winning bet to claim.</p> : null}
          {m.result === 0 && m.settled && <button className="btn-ghost w-full" disabled={busy || !!readError} onClick={() => void transact("resolve")}>{busy ? "Confirming…" : "Resolve from on-chain verdict"}</button>}
        </div>
        <p className="text-xs leading-relaxed text-muted">Winners share this pot in proportion to their winning bets. No verdict or no bets on the winning side means refunds. Payouts become available after the commitment market settles, no earlier than {fmtTime(m.goal_deadline + 600)}. There is no operator fee; rounding can leave fractions of a token unit in the contract.</p>
      </>}
      {tx && <TxLink hash={tx} label="Betting transaction" />}
      <a className="link text-xs" href={addrUrl(cfg.market_pool!)} target="_blank" rel="noreferrer">View betting contract ↗</a>
    </section>
  );
}
