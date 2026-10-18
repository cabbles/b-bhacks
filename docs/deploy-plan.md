# Deploy Cash Cow for real (no laptops, no paid services)

## Context

Today the system depends on two laptops: the web app and relayer run behind Cloudflare quick tunnels on one, and the referee runs on the other because it calls models with `claude -p`. The goal is to host it permanently for free, with model calls on a free Gemini key, AUSD still on Base Sepolia, and a design that can later grow into real accounts with users' own wallets and, eventually, mainnet.

The chosen direction is **wallets first, then serverless**. Once users connect their own wallets, every contract call except `postVerdict` can be made by anyone (`createCohort`, `stakeWithAuthorization`, `betWithAuthorization`, `settle`, `claimFor`, `resolve`; see `contracts/src/StakePool.sol` and `contracts/src/MarketPool.sol`). That means the **relayer can be deleted**, and its keeper and read endpoints can move into the referee. What's left is:

- **Web** on Vercel (free Hobby plan)
- **Referee** on Cloudflare Workers + D1 + Cron Triggers (free, no card)
- **Gemini** for model calls

Git: the branch `web-markets-bet` is already at `origin/main` (`7a91371`), so there is nothing to pull. The uncommitted work (`QuickBet.tsx`, the cohorts pages, `useLiveMarket.ts`, `docs/live-demo-2min.md`) gets committed first.

## Phase 0: Housekeeping
- Commit the current WIP on `web-markets-bet`, merge it to main, then start a branch `deploy` for this work.

## Phase 1: Gemini provider (small; works on the current Node referee)
File: `referee/src/model.ts`, `referee/src/config.ts`.
- Add `MODEL_PROVIDER=gemini` alongside `claude-cli | api | off`. Call the Gemini REST API `generateContent` with plain `fetch` (no SDK, so it also runs on Workers). Send `system_instruction`, set `responseMimeType: application/json`, and pass `responseJsonSchema` built from the existing `z.toJSONSchema(schema)` call that `cliCall` already makes.
- Keep the current contract: `structuredCall` returns `null` on any failure, so callers still fail closed. Treat HTTP 429 (free-tier rate limit) as a failure, with one backoff retry.
- `GEMINI_API_KEY` and `MODEL_NAME_A` / `MODEL_NAME_B` set the key and the two substance voters (`engine.ts:105`). Defaults are two different free-tier models, e.g. a Flash and a Flash-Lite. Check the current names and limits in AI Studio when implementing.
- Note: the "two independent models" check is weaker when both models come from the same vendor. That's fine for now; a second free provider can be added later.
- Remove the `claude-cli` path once Gemini works.

## Phase 2: Connected wallets in the web app (removes the need for a relayer)
- Add `wagmi` (with the viem the app already uses) and injected + Coinbase Wallet connectors. Skip WalletConnect for now so no project ID is needed. Replace the burner-key `useWallet` in `web/lib/wallet.ts` with a wagmi-backed hook that exposes the same shape (`address`, balance), so pages change as little as possible.
- Stake: the user signs `ReceiveWithAuthorization` with `signTypedData`, using the existing `web/lib/erc3009.ts` typed-data builder, then submits `stakeWithAuthorization` from their own wallet. Bets and bonds work the same way: they sign, then submit themselves.
- Replace each relayer call in `web/lib/api.ts` (`relayStake`, `relayBet`, `relayBond`, `relayClaim`, `createMarket`/`/groups`, market resolve and claim) with a direct `writeContract`. Read calls (`getConfig` cohort list, `getPredictionMarket`, `getBond`) move to the referee (Phase 3).
- Testnet funds: add a "Get test AUSD" button that calls the Agora faucet's `requestFunds(user)` from the user's wallet (same call as `relayer/src/fund.ts`; first check that any caller is allowed), plus a link to a Base Sepolia ETH faucet for gas. Trade-off: users need testnet ETH. Gasless can come back later with a smart wallet and paymaster.
- Update the "Join" page copy: connect a wallet instead of getting an automatic burner.

## Phase 3: Move the relayer's remaining jobs into the referee, then delete `relayer/`
- **Keeper:** port `keeperTick`, `claimAll`, and the bond/market resolve from `relayer/src/index.ts` (lines ~330–381) into the referee's tick. It pays gas with the referee key, which already pays for `postVerdict`. Store "paid out" state in the DB instead of the in-memory `paidOut` Set.
- **Index + reads:** each tick, scan `CohortCreated` / `Staked` / `Bet` / bond events in chunks of 200 blocks or fewer (keep the chunking from relayer `chain.ts`) into DB tables. Serve `/config` (cohorts), `/markets/:cohort/:owner`, and `/bonds/...` from the referee with the same response shapes the web already parses.
- Remove `relayer/`, `infra/run-relayer.sh`, `relayer_url` in `shared/deployments.json`, and `RELAYER_URL` in `web/lib/env.ts`.

## Phase 4: Port the referee to Cloudflare Workers
- **HTTP:** Fastify → Hono (`referee/src/index.ts`, `routes.ts`, `x402.ts`). The handlers stay mostly the same.
- **DB:** `better-sqlite3` → D1, which is also SQLite, so the SQL carries over. Calls become async, so `db.ts` and its callers need `await`. Write a `migrations/0001_init.sql` from the current schema in `db.ts`. Start fresh, or import the testnet history with `sqlite3 referee.db .dump` → `wrangler d1 execute --file`.
- **Worker loop:** `setInterval` in `worker.ts` becomes a `scheduled()` handler on a `* * * * *` cron. Every job must finish inside the invocation, so replace fire-and-forget with `await Promise.allSettled`. Move the in-memory state (`lastPoll` Map, `inFlight` set) into DB columns (`last_polled_at`, a simple lease row so overlapping crons skip). Cap the work per tick (e.g. ≤5 goal polls and ≤2 decisions) to stay under the free plan's 50 subrequests and CPU limit. Waiting on Gemini or the RPC doesn't count toward CPU.
- **Config:** `config.ts` reads from the Workers `env` instead of `process.env`/dotenv. Load `shared/deployments.json` with a JSON import.
- **Secrets** via `wrangler secret put`: `REFEREE_PRIVATE_KEY`, `RPC_URL`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, `ADMIN_KEY`. Leave Canvas disabled in prod.
- **Fallback:** keep runtime-specific code behind a thin interface (DB + cron entry). If Workers limits get in the way, the same Hono app can run on Vercel (Node) + Turso + a free cron-job.org ping without another rewrite.
- **Public RPC:** use a free Alchemy/Infura Base Sepolia key for `RPC_URL`. The public `sepolia.base.org` is rate-limited and caps log ranges.

## Phase 5: Deploy the web app on Vercel
- Import the repo with project root `web/`, and turn on "include files outside root" (the app imports `../shared`). pnpm workspace install.
- Env: `NEXT_PUBLIC_REFEREE_URL=https://<referee>.workers.dev`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_WEB_URL`. Commit the stable URLs to `shared/deployments.json`, then delete the tunnel docs and scripts (`infra/README.md`, `web/scripts/run-live.sh`, `referee/scripts/run-live.sh`) and update the README.
- Note: Vercel Hobby is for non-commercial use only. Moving the web to Cloudflare (OpenNext) or Vercel Pro is a later decision, needed only if this becomes a business.

## Phase 6 (later, not part of this work): mainnet checklist
Mainnet doesn't make the testnet problems go away; it trades them for real-money ones:
- **Money:** real AUSD and real ETH gas. The referee pays for every verdict and payout (cents each on Base, but not zero). Confirm that mainnet AUSD exists on Base and supports ERC-3009.
- **Contracts:** they're immutable and will hold user funds, so get an audit or at least a serious external review, then redeploy and update `shared/deployments.json`.
- **Key security:** a leaked referee key can post false verdicts and redirect forfeits. Move it to a KMS or hardware signer and consider multi-sig or timelocked verdicts.
- **Models:** the free Gemini tier isn't good enough for decisions that move real money (rate limits, and free-tier prompts may be used for training). Switch to a paid key and two different vendors.
- **Legal:** staking on your own goals with forfeits paid to others, and especially YES/NO betting on other people, likely counts as gambling or prediction-market activity, and possibly money transmission. Get legal advice (geo-restrictions, KYC) before real money.

## Verification
- **Phase 1:** run the referee locally with `MODEL_PROVIDER=gemini`. `pnpm --filter referee test`. `POST /goals/compile` returns criteria, and a sample goal reaches a substance verdict with two votes. Run `pnpm --filter redteam referee` and compare with `redteam/results.md`.
- **Phase 2–3:** run web and referee locally. In a browser wallet on Base Sepolia: connect → faucet → create group → stake → bet from a second wallet → wait for the deadline → verdict posted → keeper settles and pays → balances change. `pnpm --filter web typecheck`, `pnpm --filter web test:sig`.
- **Phase 4:** `wrangler dev --test-scheduled`, then trigger `/__scheduled` and repeat the full flow against `wrangler dev`. After deploy, `GET /health` on workers.dev and `wrangler tail` while a short (5-minute) cohort runs end to end.
- **Phase 5:** the full flow on the Vercel URL from a phone with nothing running locally, and both laptops closed.
