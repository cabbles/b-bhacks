"use client";
import { useEffect, useState } from "react";
import { baseSepolia } from "viem/chains";
import { authNonce, client, poolAbi } from "@/lib/chain";
import { getConfig } from "@/lib/api";
import { addrUrl, MOCK_CHAIN, MOCK_REFEREE, PAYMASTER_URL, REFEREE_URL, RPC_URL } from "@/lib/env";
import type { ChainConfig } from "@/lib/types";
import { fmtAmount, tokenBalance, tokenDecimals, useWallet } from "@/lib/wallet";

type Row = { name: string; ok: boolean | null; detail: React.ReactNode };

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await fn();
  return [r, Math.round(performance.now() - t)];
}

/** Pre-flight page for CP3 and the live window: is every dependency reachable and consistent? */
export default function StatusPage() {
  const { account } = useWallet();
  const [rows, setRows] = useState<Row[]>([]);
  const [cfg, setCfg] = useState<ChainConfig | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const out: Row[] = [];
    const push = (r: Row) => {
      out.push(r);
      setRows([...out]);
    };
    setRows([]);
    (async () => {
      push({ name: "Contracts mode", ok: !MOCK_CHAIN, detail: MOCK_CHAIN ? "fixtures (no pool in shared/deployments.json)" : `read directly over ${RPC_URL}` });
      push({ name: "Referee mode", ok: !MOCK_REFEREE, detail: MOCK_REFEREE ? "fixtures (no referee_url in shared/deployments.json or NEXT_PUBLIC_REFEREE_URL)" : REFEREE_URL });

      if (!MOCK_REFEREE) {
        try {
          const [r, ms] = await timed(() => fetch(REFEREE_URL + "/health", { cache: "no-store" }).then((x) => x.json()));
          push({ name: "Referee /health", ok: r?.ok === true, detail: `${REFEREE_URL} · ${ms} ms` });
        } catch (e) {
          push({ name: "Referee /health", ok: false, detail: `${REFEREE_URL} · ${(e as Error).message}` });
        }
      }

      let c: ChainConfig | null = null;
      try {
        const [r, ms] = await timed(getConfig);
        c = r;
        setCfg(r);
        push({ name: "Cohorts read", ok: true, detail: `${MOCK_CHAIN ? "fixture" : "on-chain"} · ${ms} ms · ${r.cohorts.length} cohort(s)` });
      } catch (e) {
        push({ name: "Cohorts read", ok: false, detail: (e as Error).message });
      }
      if (!c) return;

      push({ name: "Chain", ok: c.chainId === baseSepolia.id, detail: `chainId ${c.chainId} (expected ${baseSepolia.id})` });

      if (!MOCK_CHAIN) {
        const contracts = [["Stake pool", c.pool], ["Betting pool", c.market_pool], ["Bond contract", c.bond_pool], ["Token contract", c.token]] as const;
        for (const [label, addr] of contracts) {
          if (!addr) {
            push({ name: label, ok: false, detail: "no address in shared/deployments.json" });
            continue;
          }
          try {
            const code = await client.getCode({ address: addr });
            push({ name: label, ok: !!code && code !== "0x", detail: <a className="link font-mono" href={addrUrl(addr)} target="_blank" rel="noreferrer">{addr}</a> });
          } catch (e) {
            push({ name: label, ok: false, detail: `${addr} · RPC error: ${(e as Error).message}` });
          }
        }

        // The web mirrors the pool's authNonce; a mismatch means the web and the pool were built from different code.
        if (c.poolDeployed) {
          const probe = "0x3e5c02e53300b935e6edb8c6962e480928f0a50736085a4044ce1b23ff2e145b" as const;
          try {
            const onChain = await client.readContract({ address: c.pool, abi: poolAbi, functionName: "authNonce", args: [1n, probe] });
            const ok = onChain === authNonce(1, probe);
            push({ name: "Stake nonce rule", ok, detail: ok ? "web authNonce matches pool.authNonce" : `pool ${onChain} vs web ${authNonce(1, probe)}` });
          } catch (e) {
            push({ name: "Stake nonce rule", ok: false, detail: `pool.authNonce failed: ${(e as Error).message.split("\n")[0]}` });
          }
        }
      }

      const dec = await tokenDecimals(c.token, c.decimals);
      push({ name: "Token", ok: true, detail: `${dec} decimals` });
      push({ name: "Gas sponsorship", ok: !!PAYMASTER_URL, detail: PAYMASTER_URL ? "paymaster set: passkey wallets pay no gas" : "no NEXT_PUBLIC_PAYMASTER_URL: every wallet pays its own test gas" });

      const now = Date.now() / 1000;
      const open = c.cohorts.filter((x) => x.stake_deadline > now);
      push({
        name: "Open cohorts",
        ok: open.length > 0,
        detail: open.length ? open.map((x) => `#${x.id} (${fmtAmount(x.stake_amount, dec)} AUSD)`).join(", ") : "none taking stakes",
      });
    })();
  }, [run]);

  const [bal, setBal] = useState<bigint | null>(null);
  const [dec, setDec] = useState(6);
  useEffect(() => {
    if (!cfg || !account) return;
    tokenDecimals(cfg.token, cfg.decimals).then(setDec);
    tokenBalance(cfg.token, account.address).then(setBal);
  }, [cfg, account, run]);

  return (
    <div className="space-y-10">
      <header className="flex items-end gap-4">
        <div className="flex-1">
          <div className="label">Pre-flight</div>
          <h1 className="display text-6xl sm:text-8xl">Status.</h1>
        </div>
        <button className="btn-ghost" onClick={() => setRun((n) => n + 1)}>Re-run</button>
      </header>
      <ul className="border-t border-line">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[1rem_10rem_1fr] items-baseline gap-x-3 border-b border-line py-3 text-sm">
            <span className={`inline-block h-2 w-2 ${r.ok === null ? "bg-muted" : r.ok ? "bg-pass" : "bg-fail"}`} aria-label={r.ok ? "ok" : "not ok"} />
            <span className="font-medium">{r.name}</span>
            <span className="num min-w-0 break-words text-xs text-muted">{r.detail}</span>
          </li>
        ))}
      </ul>
      <div>
        <div className="label">Connected wallet</div>
        <div className="num break-all border-t border-line pt-3 text-sm">{account?.address ?? "not connected"}</div>
        <div className="num text-xs text-muted">balance {bal === null ? "…" : fmtAmount(bal, dec)} AUSD</div>
      </div>
    </div>
  );
}
