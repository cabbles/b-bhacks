"use client";
import { useEffect, useRef, useState } from "react";
import { useConnect, useConnectors, useDisconnect } from "wagmi";
import { short } from "@/lib/time";
import { ADDRESSES, addrUrl, ETH_FAUCET_URL } from "@/lib/env";
import { calls, gasSponsored, send } from "@/lib/tx";
import { fmtAmount, tokenBalance, tokenDecimals, useWallet } from "@/lib/wallet";
import { ErrorBox, Spinner, TxLink } from "./ui";

/** Connector choices: a Base Account (passkey) first, then whatever browser wallets are installed. */
function useWalletOptions() {
  const connectors = useConnectors();
  const named = connectors.filter((c) => c.id !== "injected" && c.id !== "baseAccount");
  const generic = connectors.find((c) => c.id === "injected");
  return [
    ...connectors.filter((c) => c.id === "baseAccount").map((c) => ({ connector: c, label: "Sign in with a passkey", hint: "Base Account · no app, no gas needed" })),
    ...named.map((c) => ({ connector: c, label: c.name, hint: "Browser wallet · pays its own test gas" })),
    // Only offer the generic option when no wallet announced itself by name.
    ...(named.length === 0 && generic && typeof window !== "undefined" && "ethereum" in window
      ? [{ connector: generic, label: "Browser wallet", hint: "Pays its own test gas" }]
      : []),
  ];
}

/** The header button: connect, or show the connected address with a way to disconnect. */
export function WalletButton() {
  const { account } = useWallet();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="rounded-full bg-panel px-3 py-1.5 font-display text-[13px] font-semibold text-fg hover:bg-line sm:text-sm" onClick={() => setOpen((o) => !o)}>
        {account ? short(account.address) : "Connect"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-line bg-ink p-4 shadow-lg">
          {account ? (
            <div className="space-y-3 text-sm">
              <a className="num block break-all hover:text-nose-deep" href={addrUrl(account.address)} target="_blank" rel="noreferrer">{account.address}</a>
              <button type="button" className="btn-ghost w-full" onClick={() => { disconnect(); setOpen(false); }}>Disconnect</button>
            </div>
          ) : (
            <ConnectOptions onDone={() => setOpen(false)} />
          )}
        </div>
      )}
    </div>
  );
}

export function ConnectOptions({ onDone }: { onDone?: () => void }) {
  const options = useWalletOptions();
  const { connectAsync } = useConnect();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go(o: (typeof options)[number]) {
    setBusy(o.connector.uid);
    setErr(null);
    try {
      await connectAsync({ connector: o.connector });
      onDone?.();
    } catch (e) {
      const msg = (e as Error).message;
      if (!/reject|denied|cancel/i.test(msg)) setErr(msg.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {options.map((o) => (
        <button key={o.connector.uid} type="button" className="flex w-full flex-col items-start rounded-lg border-2 border-fg px-3 py-2 text-left hover:bg-panel disabled:opacity-50" disabled={!!busy} onClick={() => void go(o)}>
          <span className="font-display font-semibold">{busy === o.connector.uid ? <><Spinner /> Connecting…</> : o.label}</span>
          <span className="text-xs text-muted">{o.hint}</span>
        </button>
      ))}
      <p className="pt-1 text-xs text-muted">Testnet only. Never send real funds to these contracts.</p>
      <ErrorBox msg={err} />
    </div>
  );
}

/** Balance plus the test-AUSD faucet, and a pointer to test ETH for wallets that pay their own gas. */
export function FundsPanel() {
  const { account } = useWallet();
  const [bal, setBal] = useState<bigint | null>(null);
  const [dec, setDec] = useState(6);
  const [sponsored, setSponsored] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    tokenDecimals(ADDRESSES.token).then(setDec);
    gasSponsored().then(setSponsored);
    const load = () => tokenBalance(ADDRESSES.token, account.address).then(setBal);
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [account, tx]);

  if (!account) {
    return (
      <div className="border-t border-line pt-3">
        <p className="mb-3 text-sm text-fg/80">Connect a wallet to stake and bet. A passkey account needs no app and no gas.</p>
        <ConnectOptions />
      </div>
    );
  }

  async function getAusd() {
    if (!account) return;
    setBusy(true);
    setErr(null);
    try {
      const { hash } = await send(calls.faucet(account.address));
      setTx(hash);
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line pt-3">
      <a className="num break-all text-sm text-fg hover:text-nose-deep" href={addrUrl(account.address)} target="_blank" rel="noreferrer">{account.address}</a>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted">Balance</dt>
        <dd className="num text-right text-2xl font-semibold">
          {bal === null ? "…" : fmtAmount(bal, dec)} <span className="text-sm text-muted">AUSD</span>
        </dd>
        <dt className="text-muted">Gas</dt>
        <dd className="text-right">{sponsored === null ? "…" : sponsored ? "covered for you" : "paid by your wallet"}</dd>
      </dl>
      <button type="button" className="btn-ghost mt-4 w-full" disabled={busy} onClick={() => void getAusd()}>
        {busy ? <><Spinner /> Requesting…</> : "Get test AUSD"}
      </button>
      {tx && <div className="mt-2 text-sm"><TxLink hash={tx} label="Faucet" /></div>}
      {sponsored === false && (
        <p className="mt-3 text-xs text-muted">
          Your wallet pays its own gas, so it needs a little Base Sepolia test ETH (free) from a{" "}
          <a className="link" href={ETH_FAUCET_URL} target="_blank" rel="noreferrer">faucet</a>. A passkey account skips this step.
        </p>
      )}
      <ErrorBox msg={err} />
    </div>
  );
}
