# AI Referee

> **Testnet only.** Everything runs on Base Sepolia with free test AUSD. Nothing here has real value.

You stake testnet AUSD on finishing something by a deadline. An AI referee gathers the evidence itself, rules pass or fail with reasons, and a contract pays out. Forfeited stakes go to the people who passed. The operator has no way to withdraw.

Built at B@BHacks 2.0. Tracks: AUSD, YZi Labs, General (Most Creative).

## What makes it different

1. **The referee observes evidence itself.** It never trusts uploads or claimed timestamps. It records when it first saw each commit, so a commit backdated with `git commit --date` does not count.
2. **Fool the Ref.** Anyone can declare a cheat attempt before the deadline and try to get an unfinished goal approved. Every attempt is shown on a public board, including the ones that worked.
3. **The referee cannot profit.** The contract has no owner withdrawal. If no verdict is posted, the staker gets a full refund.

## How it works

```mermaid
flowchart LR
  U[Phone browser<br/>burner key in localStorage] -->|compile goal| R[Referee<br/>Fastify + SQLite]
  U -->|signed ERC-3009 auth| L[Relayer<br/>pays gas]
  L -->|stakeWithAuthorization| P[(StakePool<br/>Base Sepolia)]
  U -->|register goal| R
  R -->|polls| G[GitHub / URL / Canvas]
  R -->|postVerdict + evidenceHash| P
  L -->|settle, claimFor| P
  P -->|AUSD| U
```

1. **Join.** Scan the QR code. The web app creates a key in your browser and the relayer sends you 100 test AUSD. You don't need to install anything or save a seed phrase.
2. **Stake.** Type a goal in plain words. The referee compiles it into frozen criteria JSON and shows a one-sentence summary plus a control proof: a nonce file to add to your repo, or a nonce to put on your page. You sign an ERC-3009 `ReceiveWithAuthorization` and the relayer submits it, so you never need ETH.
3. **Watch.** The referee polls your repo or URL and records when it first saw each piece of evidence.
4. **Verdict.** Deterministic checks run first. A `substance` check asks two independent model calls whether the work actually delivers the goal; if they disagree, the goal goes to a human and the override is counted publicly. The verdict JSON is hashed (`keccak256(canonical(verdict))`) and posted on-chain.
5. **Settle.** Ten minutes after the deadline anyone can call `settle`. Passers get their stake back plus an equal share of the forfeits. If nobody passed, or no verdict was posted, everyone is refunded.

## Repo layout

| Path         | What                                                         |
| ------------ | ------------------------------------------------------------ |
| `contracts/` | `StakePool.sol`, Foundry tests, deploy script                |
| `relayer/`   | Gas relayer, AUSD drip, claim trigger                        |
| `referee/`   | Referee API, evidence collectors, verdict engine             |
| `web/`       | Next.js app (join, stake, verdict, cohort board, Fool the Ref) |
| `redteam/`   | Scripted cheats and results table                            |
| `shared/`    | Schemas, ABI, deployments, fixtures, canonical JSON helper   |
| `docs/`      | Demo script and screenshots                                  |

## Running the web app

```bash
cd web
pnpm install
cp .env.example .env.local   # optional: override URLs or set NEXT_PUBLIC_MOCK=1
pnpm dev
```

Service URLs come from `shared/deployments.json` (`relayer_url`, `referee_url`); `NEXT_PUBLIC_RELAYER_URL` / `NEXT_PUBLIC_REFEREE_URL` override them. A service with no URL is served from fixtures (**mock mode**), each one independently; `NEXT_PUBLIC_MOCK=1` forces fixtures for both, for rehearsals and screenshots. Staking stays disabled until the pool is deployed and both services are live.

| Screen        | Route            |
| ------------- | ---------------- |
| Join          | `/`              |
| Stake         | `/stake?cohort=1`|
| Goal/verdict  | `/goals/:id`     |
| Cohort board (projector) | `/cohorts/:id` |
| Fool the Ref  | `/fool`          |
| System status (pre-flight) | `/status` |

In mock mode, a goal you stake is judged 20 seconds later: honest goals pass and declared cheat attempts are caught, so you can rehearse the whole flow without a backend.

`pnpm test:sig` checks that the ERC-3009 `ReceiveWithAuthorization` signatures the app produces recover to the staker.

### Deploying the web app

Either way, set `NEXT_PUBLIC_REFEREE_URL` (and `NEXT_PUBLIC_RELAYER_URL`) if they are not yet in `shared/deployments.json`, and set `NEXT_PUBLIC_WEB_URL` to the public URL so the join QR code points at it.

- **Vercel (recommended, stable URL, no laptop):** import the repo, set Root Directory to `web`, keep the Next.js preset, add the env vars above. The app imports `../shared` and Vercel includes files outside the root directory by default.
- **Team laptop:** `nohup web/scripts/run-live.sh > /dev/null 2>&1 &` builds and serves on port 3000 with auto-restart. Add `WEB_TUNNEL=cloudflared` (or `WEB_TUNNEL=ngrok NGROK_URL=...`) for a public URL. Logs are in `web/logs/`.

## Screenshots

Captured in mock mode; replace them with live captures at code freeze.

| Join | Verdict (fail) | Fool the Ref |
| ---- | -------------- | ------------ |
| ![Join](docs/screenshots/join.png) | ![Verdict fail](docs/screenshots/verdict-fail.png) | ![Fool the Ref](docs/screenshots/fool.png) |

![Cohort board](docs/screenshots/board.png)

## Live cohort results

_Filled in at code freeze (4:20 PT)._

| Metric | Count |
| ------ | ----- |
| Real stakers | TBD |
| Fool the Ref attempts | TBD |
| Human overrides | TBD |

## Red team

_Copied from `redteam/results.md` at code freeze._

| Category | Caught | Fooled |
| -------- | ------ | ------ |
| Backdated commits | TBD | TBD |
| Someone else's repo | TBD | TBD |
| Filler commits | TBD | TBD |
| Prompt injection | TBD | TBD |
| Fake static page | TBD | TBD |
| On-chain (bad verdict signer, replay, double claim) | TBD | TBD |

## Safety

- Testnet only. No mainnet deployment exists.
- No function in `StakePool` sends funds to the owner, the referee, or the relayer.
- Content the referee gathers is passed to models as quoted data. Model output must validate against a schema, or the check fails closed.
- The verdict engine never sees whether a goal was declared as a cheat attempt.
