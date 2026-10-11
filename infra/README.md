# infra (Agent A)

How the three services run for the event. Everything is on Base Sepolia (chain 84532); addresses and public URLs are in `shared/deployments.json`.

| Service | Where | Public URL | Start |
|---|---|---|---|
| Relayer (`relayer/`) | A's laptop, port 8788 | `relayer_url` (Cloudflare quick tunnel) | `bash infra/run-relayer.sh` |
| Web (`web/`) | A's laptop, port 3000 | `web_url` (Cloudflare quick tunnel) | `bash infra/run-web.sh` (macOS: `web/scripts/run-live.sh`) |
| Referee (`referee/`) | B's laptop, port 8787 (needs a logged-in `claude` CLI) | `referee_url` (ngrok) | `referee/scripts/run-live.sh` |

The `run-*.sh` scripts restart their service if it exits. Tunnels run separately, so a service restart keeps the same URL:

```
cloudflared tunnel --no-autoupdate --url http://localhost:8788   # relayer
cloudflared tunnel --no-autoupdate --url http://localhost:3000   # web
```

A quick-tunnel URL changes only when the tunnel itself restarts. If that happens, update `shared/deployments.json`, rebuild the web app, and tell the team.

## Secrets (`.env` at the repo root, never committed)

`RPC_URL`, `TREASURY_PRIVATE_KEY` (relayer: pays gas, holds the AUSD for `/drip`), `ADMIN_KEY` (relayer admin routes). The referee keeps its own keys in `referee/.env`.

## Contract

`StakePool` `0x1470af4526f820DC7Ca5bE70cA77bBf2400e76f9`, deployed with `contracts/script/Deploy.s.sol`, then `node contracts/scripts/export.mjs` writes the ABI and addresses to `shared/`. Referee (immutable): `0x57CB6D4f98979403D89A6c2d6A7c17ef4D54eD3B`. Token: testnet AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, EIP-712 domain `Agora Dollar` / `1`.

## Operations

- **Treasury top-up:** `pnpm --filter relayer fund` mints 10,000 AUSD from the Agora faucet (needs a little Base Sepolia ETH).
- **Create a cohort:** `POST /admin/cohorts` with header `x-admin-key` and body `{ stake_minutes, goal_minutes, stake }` or `{ stake_deadline, goal_deadline, stake }` (unix seconds). Anyone can start a group with the public `POST /groups` and body `{ stake_minutes, goal_minutes, stake }`.
- **Settle and pay out:** automatic. The relayer's keeper settles each cohort 11 minutes after its goal deadline (the contract allows it at 10), then calls `claimFor` for every staker. Manual fallback: `POST /admin/settle`, `POST /admin/claim-all`.
- **Red team:** `pnpm --filter redteam onchain`, `pnpm --filter redteam referee`, `pnpm --filter redteam report`, which writes `redteam/results.md`.

## Known limits

- The public RPC `sepolia.base.org` caps `eth_getLogs` at 200 blocks and lags a few seconds behind receipts. The relayer scans logs in chunks and retries simulations.
- Quick tunnels are for the event only. A real deployment would put the relayer and referee on long-running hosts with stable domains.
