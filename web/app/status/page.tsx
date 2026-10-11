"use client";
import { useEffect, useState } from "react";
import { baseSepolia } from "viem/chains";
import { client, poolAbi } from "@/lib/chain";
import { authNonce } from "@/lib/erc3009";
import { getConfig } from "@/lib/api";
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
          const [r, ms] = await timed(() => fetch(REFEREE_URL + "/health", { cache: "no-store" }).then((x) => x.json()));
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
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-black">System status</h1>
        <button className="btn-ghost py-2" onClick={() => setRun((n) => n + 1)}>Re-run</button>
      </div>
      <ul className="card divide-y divide-zinc-800">
        {rows.map((r) => (
          <li key={r.name} className="flex gap-3 py-2 first:pt-0 last:pb-0">
            <span className={r.ok === null ? "text-zinc-500" : r.ok ? "text-green-400" : "text-red-400"}>{r.ok ? "●" : "○"}</span>
            <span className="w-36 shrink-0 font-semibold">{r.name}</span>
            <span className="min-w-0 break-words text-sm text-zinc-300">{r.detail}</span>
          </li>
        ))}
      </ul>
      <div className="card text-sm">
        <div className="label">This browser&apos;s wallet</div>
        <div className="break-all font-mono">{account?.address ?? "…"}</div>
        <div className="text-zinc-400">
          Faucet: {dripState} · balance {bal === null ? "…" : fmtAmount(bal, dec)} AUSD
        </div>
      </div>
    </div>
  );
}
