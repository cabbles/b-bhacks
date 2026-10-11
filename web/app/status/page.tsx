"use client";
import { useEffect, useState } from "react";
import { baseSepolia } from "viem/chains";
import { client, poolAbi } from "@/lib/chain";
import { authNonce } from "@/lib/erc3009";
import { getConfig, TUNNEL_HEADERS } from "@/lib/api";
import { addrUrl, MOCK_REFEREE, MOCK_RELAYER, REFEREE_URL, RELAYER_URL } from "@/lib/env";
import type { RelayerConfig } from "@/lib/types";
import { fmtAmount, tokenBalance, tokenDecimals, useWallet } from "@/lib/wallet";

type Row = { name: string; ok: boolean | null; detail: React.ReactNode };

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await fn();
  return [r, Math.round(performance.now() - t)];
}

/** Pre-flight page for CP3 and the live window: is every dependency reachable and consistent? */
export default function StatusPage() {
  const { account, dripState } = useWallet();
  const [rows, setRows] = useState<Row[]>([]);
  const [cfg, setCfg] = useState<RelayerConfig | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const out: Row[] = [];
    const push = (r: Row) => {
      out.push(r);
      setRows([...out]);
    };
    setRows([]);
    (async () => {
      push({ name: "Relayer mode", ok: !MOCK_RELAYER, detail: MOCK_RELAYER ? "fixtures (no relayer_url in shared/deployments.json or NEXT_PUBLIC_RELAYER_URL)" : RELAYER_URL });
      push({ name: "Referee mode", ok: !MOCK_REFEREE, detail: MOCK_REFEREE ? "fixtures (no referee_url in shared/deployments.json or NEXT_PUBLIC_REFEREE_URL)" : REFEREE_URL });

      if (!MOCK_REFEREE) {
        try {
          const [r, ms] = await timed(() => fetch(REFEREE_URL + "/health", { cache: "no-store", headers: TUNNEL_HEADERS }).then((x) => x.json()));
          push({ name: "Referee /health", ok: r?.ok === true, detail: `${REFEREE_URL} · ${ms} ms` });
        } catch (e) {
          push({ name: "Referee /health", ok: false, detail: `${REFEREE_URL} · ${(e as Error).message}` });
        }
      }

      let c: RelayerConfig | null = null;
      try {
        const [r, ms] = await timed(getConfig);
        c = r;
        setCfg(r);
        push({ name: "Relayer /config", ok: true, detail: `${MOCK_RELAYER ? "fixture" : RELAYER_URL} · ${ms} ms · ${r.cohorts.length} cohort(s)` });
      } catch (e) {
        push({ name: "Relayer /config", ok: false, detail: (e as Error).message });
      }
      if (!c) return;

      push({ name: "Chain", ok: c.chainId === baseSepolia.id, detail: `chainId ${c.chainId} (expected ${baseSepolia.id})` });

      if (!MOCK_RELAYER && !c.poolDeployed) push({ name: "Pool contract", ok: false, detail: "not deployed yet (pool is null in /config)" });
      if (!MOCK_RELAYER) {
        const contracts = c.poolDeployed ? ([["Pool contract", c.pool], ["Token contract", c.token]] as const) : ([["Token contract", c.token]] as const);
        for (const [label, addr] of contracts) {
          try {
            const code = await client.getCode({ address: addr });
            push({ name: label, ok: !!code && code !== "0x", detail: <a className="link font-mono" href={addrUrl(addr)} target="_blank" rel="noreferrer">{addr}</a> });
          } catch (e) {
            push({ name: label, ok: false, detail: `${addr} · RPC error: ${(e as Error).message}` });
          }
        }

        // The stake signature's nonce must equal the pool's authNonce, or every stake reverts with BadNonce.
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
      push({ name: "Token", ok: true, detail: `EIP-712 domain "${c.tokenDomain.name}" v${c.tokenDomain.version} · ${dec} decimals` });

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
  }, [cfg, account, dripState, run]);

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
        <div className="label">This browser&apos;s wallet</div>
        <div className="num break-all border-t border-line pt-3 text-sm">{account?.address ?? "…"}</div>
        <div className="num text-xs text-muted">
          faucet {dripState} · balance {bal === null ? "…" : fmtAmount(bal, dec)} AUSD
        </div>
      </div>
    </div>
  );
}
