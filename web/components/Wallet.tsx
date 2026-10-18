"use client";
import { useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import { useConnect, useConnectors, useDisconnect } from "wagmi";
import { short } from "@/lib/time";
import { ADDRESSES, addrUrl, ETH_FAUCET_URL, METAMASK_URL } from "@/lib/env";
import { client } from "@/lib/chain";
import { calls, send } from "@/lib/tx";
import { fmtAmount, tokenBalance, tokenDecimals, useWallet } from "@/lib/wallet";
import { ErrorBox, Spinner, TxLink } from "./ui";

/** Connector choices: installed browser wallets by name, MetaMask first. */
function useWalletOptions() {
  const connectors = useConnectors();
  const named = connectors
    .filter((c) => c.id !== "injected")
    .sort((a, b) => Number(/metamask/i.test(b.name)) - Number(/metamask/i.test(a.name)));
  const generic = connectors.find((c) => c.id === "injected");
  return [
    ...named.map((c) => ({ connector: c, label: c.name, hint: "Browser wallet" })),
    // Only offer the generic option when no wallet announced itself by name.
    ...(named.length === 0 && generic && typeof window !== "undefined" && "ethereum" in window
      ? [{ connector: generic, label: "Browser wallet", hint: "Your installed wallet" }]
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
      {options.length === 0 && (
        <p className="text-sm text-fg/80">
          No wallet found in this browser. <a className="link" href={METAMASK_URL} target="_blank" rel="noreferrer">Install MetaMask</a>, then
          reload this page.
        </p>
      )}
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
  const [eth, setEth] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    tokenDecimals(ADDRESSES.token).then(setDec);
    const load = () => {
      tokenBalance(ADDRESSES.token, account.address).then(setBal);
      client.getBalance({ address: account.address }).then(setEth, () => setEth(null));
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [account, tx]);

  if (!account) {
    return (
      <div className="border-t border-line pt-3">
        <p className="mb-3 text-sm text-fg/80">Connect a browser wallet such as MetaMask to stake and bet.</p>
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
        <dt className="text-muted">Test ETH (gas)</dt>
        <dd className="num text-right">{eth === null ? "…" : Number(formatEther(eth)).toPrecision(2)}</dd>
      </dl>
      <button type="button" className="btn-ghost mt-4 w-full" disabled={busy} onClick={() => void getAusd()}>
        {busy ? <><Spinner /> Requesting…</> : "Get test AUSD"}
      </button>
      {tx && <div className="mt-2 text-sm"><TxLink hash={tx} label="Faucet" /></div>}
      {eth === 0n && (
        <p className="mt-3 text-xs text-muted">
          Transactions need a little Base Sepolia test ETH for gas (free) from a{" "}
          <a className="link" href={ETH_FAUCET_URL} target="_blank" rel="noreferrer">faucet</a>, unless your wallet offers to cover the
          fee (MetaMask sometimes does).
        </p>
      )}
      <ErrorBox msg={err} />
    </div>
  );
}
