"use client";
import { useRef, useState } from "react";
import { parseUnits } from "viem";
import { getPredictionMarket } from "@/lib/api";
import { calls, send } from "@/lib/tx";
import { fmtAmount, tokenBalance, useWallet } from "@/lib/wallet";
import { usePoll } from "@/lib/time";
import type { ChainConfig } from "@/lib/types";
import { ErrorBox, Spinner, TxLink } from "./ui";
import { ConnectOptions } from "./Wallet";

type Props = { cohortId: number; owner: `0x${string}`; title: string; cfg: ChainConfig; onClose: () => void; bare?: boolean };

/** Bet YES or NO on a market straight from the markets list, with a confirmation step. Same flow as the market page. */
export function QuickBet({ cohortId, owner, title, cfg, onClose, bare }: Props) {
  const { account } = useWallet();
  const [side, setSide] = useState(true);
  const [amount, setAmount] = useState("10");
  const [confirming, setConfirming] = useState(false);
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
  }, 5000, [account?.address, cohortId, owner, tx]);

  const m = data?.market;
  const ownerWallet = account?.address.toLowerCase() === owner.toLowerCase();
  const yes = ownerWallet || side;
  let raw = 0n;
  if (new RegExp(`^\\d+(?:\\.\\d{1,${dec}})?$`).test(amount)) {
    try { raw = parseUnits(amount, dec); } catch {}
  }
  const open = !!m && m.result === 0 && !m.settled && Date.now() < m.betting_deadline * 1000;
  const insufficient = data?.balance != null && raw > data.balance;
  const canBet = open && !!account && !readError && raw > 0n && data?.balance != null && !insufficient && !busy;

  async function placeBet() {
    if (!account || !m || locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      if (!canBet) throw new Error("Check the amount, balance and betting deadline.");
      const { hash } = await send(calls.bet(cohortId, owner, yes, raw));
      setTx(hash);
    } catch (e) {
      setError((e as Error).message);
    } finally { locked.current = false; setBusy(false); }
  }

  return (
    <div className={bare ? "w-full space-y-4" : "w-full space-y-4 border-l-2 border-fg/20 pl-4"}>
      <ErrorBox msg={error || readError} />
      {!account ? <ConnectOptions /> : !m ? <Spinner /> : tx ? (
        <div className="space-y-2 text-sm">
          <p className="text-pass">Bet placed: {amount} AUSD on {yes ? "YES" : "NO"}.</p>
          <TxLink hash={tx} label="Betting transaction" />
          <div><button type="button" className="btn-ghost" onClick={onClose}>Done</button></div>
        </div>
      ) : !open ? (
        <p className="text-sm text-muted">Betting on this market has closed.</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (canBet) setConfirming(true); }} className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-2">
              <button type="button" aria-pressed={yes} disabled={busy} onClick={() => setSide(true)} className={yes ? "btn-primary" : "btn-ghost"}>YES</button>
              <button type="button" aria-pressed={!yes} disabled={busy || ownerWallet} onClick={() => setSide(false)} className={!yes ? "btn-primary" : "btn-ghost"}>NO</button>
            </div>
            <label className="min-w-[8rem] flex-1 text-sm">
              <span className="label">Stake (test AUSD)</span>
              <input className="input" inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <button type="submit" className="btn-primary" disabled={!canBet}>{busy ? "Confirming…" : `Bet ${yes ? "YES" : "NO"}`}</button>
          </div>
          <p className="num text-xs text-muted">
            YES {fmtAmount(m.yes_total, dec)} · NO {fmtAmount(m.no_total, dec)} AUSD · Your balance {data?.balance == null ? "unavailable" : `${fmtAmount(data.balance, dec)} AUSD`}
          </p>
          {ownerWallet && <p className="text-xs text-muted">This is your task. Your wallet can only bet YES.</p>}
          {insufficient && <p className="text-sm text-fail">Not enough test AUSD for this bet.</p>}
        </form>
      )}
      {confirming && m && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/60 p-4" role="dialog" aria-modal="true" aria-labelledby={`quick-bet-${cohortId}`}>
          <div className="w-full max-w-md rounded-2xl bg-ink p-6">
            <div className="label">Confirm your bet</div>
            <h3 id={`quick-bet-${cohortId}`} className="font-display text-3xl font-bold">
              {amount} AUSD on <span className={yes ? "text-pass" : "text-fail"}>{yes ? "YES" : "NO"}</span>
            </h3>
            <p className="mt-2 text-sm text-muted">Market #{cohortId}: {title}</p>
            <p className="mt-3 text-fg/80">
              {yes ? "You win if they finish the task by the deadline." : "You win if they miss the task."} Winners split the losing side&apos;s bets in proportion to what they bet
              {yes ? "." : ", and NO bettors also split the owner's stake if they miss."} If you are wrong, you lose this bet.
            </p>
            <p className="mt-2 text-sm text-muted">This can&apos;t be undone. If no verdict is posted, everyone is refunded.</p>
            <div className="mt-6 flex gap-3">
              <button type="button" className="btn-ghost flex-1" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="btn-primary flex-1" onClick={() => { setConfirming(false); void placeBet(); }}>Place bet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The controls, disabled, when there is nothing to bet on yet (no confirmed task, or the chain is unreachable). */
export function QuickBetPending({ reason }: { reason: string }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" disabled>YES</button>
        <button type="button" className="btn-ghost flex-1" disabled>NO</button>
      </div>
      <button type="button" className="btn-primary w-full" disabled>Bet</button>
      <p className="text-xs text-muted">{reason}</p>
    </div>
  );
}
