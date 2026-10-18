# Deploy Cash Cow for real (no laptops, no paid services)

## Context

Today the system depends on two laptops: the web app and relayer run behind Cloudflare quick tunnels on one, and the referee runs on the other because it calls models with `claude -p`. The goal is to host it permanently for free, with model calls on a free Gemini key, AUSD still on Base Sepolia, and a design that can later grow into real accounts with users' own wallets and, eventually, mainnet.

The chosen direction is **wallets first, then serverless**. Once users connect their own wallets, every contract call except `postVerdict` can be made by anyone (`createCohort`, `stakeWithAuthorization`, `betWithAuthorization`, `settle`, `claimFor`, `resolve`; see `contracts/src/StakePool.sol` and `contracts/src/MarketPool.sol`). That means the **relayer can be deleted**, and its keeper and read endpoints can move into the referee. What's left is:

- **Web** on Vercel (free Hobby plan)
- **Referee** on Cloudflare Workers + D1 + Cron Triggers (free, no card)
- **Gemini** for model calls

Git: the branch `web-markets-bet` is already at `origin/main` (`7a91371`), so there is nothing to pull. The uncommitted work (`QuickBet.tsx`, the cohorts pages, `useLiveMarket.ts`, `docs/live-demo-2min.md`) gets committed first.

## Status (2026-10-17)

Code for phases 1–5 is done on the `deploy` branch and tested locally (unit tests, contract tests incl. a fork test on real AUSD, a keeper end-to-end test on anvil, the referee in local workerd + D1, the web build). Changes from the plan as written: the contracts gained direct `stake`/`bet`/`bond` functions (passkey wallets can't produce the v/r/s signatures the old functions need), so they get redeployed; the web reads the chain directly, so the referee did not need the relayer's read endpoints; and the keeper also pays winning bettors.

Still to do, all needing accounts or keys: get a Gemini key and run a real compile and verdict; create keys and redeploy the contracts; deploy the Worker, the paymaster and the Vercel site; run the end-to-end check. Step by step: [`infra/README.md`](../infra/README.md).

**Update (2026-10-18):** wallets are browser wallets only (MetaMask first). The Coinbase passkey wallet and its paymaster were dropped: Coinbase's sponsorship switch is shared between testnet and real mainnet, which meant real-money exposure for a test app, and MetaMask can cover gas itself on some networks. The wallet background below is kept for the record.

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

### Background: the two kinds of wallets
A wallet is a key that proves "this account is mine" and lets you sign things.

- **Regular wallet (MetaMask, Coinbase Wallet app, Rabby…).** A browser extension or phone app with a 12-word recovery phrase. The account *is* the key. **Every transaction needs ETH in that same account to pay gas.**
- **Smart wallet (Coinbase Smart Wallet).** The account is a small program on-chain, controlled by a **passkey** (Face ID or fingerprint). Nothing to install, no recovery phrase. Because the account is a program, it can let a **paymaster** (a service that pays fees for users) pay its gas, so the user never needs ETH.

**Why Coinbase Smart Wallet:** Base is Coinbase's chain, so their smart wallet and paymaster work best there. The paymaster is free on Base Sepolia, and sign-up is a single passkey prompt, which is the closest thing to today's "open the site and you're in" burner key. Other smart wallets would also work.

**A naming trap:** "Coinbase" means three things. The **exchange** (buying crypto with ID checks) is *not used*. **Coinbase Wallet** is a regular wallet like MetaMask. **Coinbase Smart Wallet** is the passkey one. Users need no Coinbase account and no ID.

**What users see:** a "Connect wallet" button.
| Option | Setup | Gas |
|---|---|---|
| Sign up with passkey (Coinbase Smart Wallet) | One Face ID / fingerprint prompt | Paid by our free paymaster, no ETH needed |
| MetaMask or another regular wallet | Already installed | User pays, so they need test ETH from a faucet (we link one) |

Both get test AUSD from the same "Get test AUSD" button. To check at build time: MetaMask has been adding smart-account features, which may let it use the paymaster too. If so, MetaMask users won't need test ETH either.

### Work
- Add `wagmi` (with the viem the app already uses) and injected + Coinbase Wallet connectors. Skip WalletConnect for now so no project ID is needed. Replace the burner-key `useWallet` in `web/lib/wallet.ts` with a wagmi-backed hook that exposes the same shape (`address`, balance), so pages change as little as possible.
- Stake: the user signs `ReceiveWithAuthorization` with `signTypedData`, using the existing `web/lib/erc3009.ts` typed-data builder, then submits `stakeWithAuthorization` from their own wallet. Bets and bonds work the same way: they sign, then submit themselves.
- Replace each relayer call in `web/lib/api.ts` (`relayStake`, `relayBet`, `relayBond`, `relayClaim`, `createMarket`/`/groups`, market resolve and claim) with a direct `writeContract`. Read calls (`getConfig` cohort list, `getPredictionMarket`, `getBond`) move to the referee (Phase 3).
- Testnet AUSD: a "Get test AUSD" button that calls the Agora faucet `requestFunds(user)` (`0xd236…ee6C`) for the user. Checked 2026-10-17: a brand-new random address can call it.
- Gas, default path: **Coinbase Smart Wallet + a free Base Sepolia paymaster** (Coinbase Developer Platform). Users sign up with a passkey (no extension, no seed phrase, no ETH), and the paymaster pays their gas. This is about as smooth as the old burner key, but nobody else holds their key. Use wagmi's `useSendCalls` with the `paymasterService` capability, so a sign-and-stake becomes one sponsored call.
  - Signatures: a smart wallet signs with ERC-1271, not a plain ECDSA key. AUSD's implementation (`0xc1e3…12da`) calls `isValidSignature`, so it appears to accept them. Confirm with a real stake on testnet. If the wallet hasn't been deployed yet, its signature is wrapped in ERC-6492, so do a sponsored deploy (any first call) before the first ERC-3009 signature.
  - Paymaster policy: allow only our contracts and functions (`StakePool`, `MarketPool`, `CommitmentBond`, the faucet), with per-user limits, so nobody can drain the sponsorship.
- Gas, other wallets (MetaMask etc.): they pay their own gas, with a link to a Base Sepolia ETH faucet.
- Update the "Join" page copy: connect a wallet instead of getting an automatic burner.

## Phase 3: Move the relayer's remaining jobs into the referee, then delete `relayer/`
- **Keeper:** port `keeperTick`, `claimAll`, and the bond/market resolve from `relayer/src/index.ts` (lines ~330–381) into the referee's tick. Pay its gas with a **separate keeper key** (settle, claim and resolve can be called by anyone, so this key has no special power), not the referee key. If the keeper key leaks, only its small ETH balance is lost. Store "paid out" state in the DB instead of the in-memory `paidOut` Set.
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

## Security (applies to every phase)

**Keys: one key per job, each holding as little as possible**
| Key | Can do | Where it lives | If it leaks |
|---|---|---|---|
| Referee key (`0x57CB…eD3B`, fixed in `StakePool`) | Post verdicts | Cloudflare Worker secret only | False verdicts can redirect forfeits. Rotating it means redeploying `StakePool`. |
| Keeper key (new) | Pay gas for settle and claim (anyone can call these) | Cloudflare Worker secret only | Its small ETH balance |
| Treasury key (relayer) | Faucet + gas | **Retired with the relayer**; move its leftover test funds out | — |
- Never put a key in a file that gets committed, in a `NEXT_PUBLIC_*` variable, in logs or in error messages. Cloudflare secrets can't be read back after they're set. Delete the laptop `.env` copies once the Worker is live.
- Generate fresh keeper and admin keys for the deploy; don't reuse hackathon keys that went through laptops and tunnels. Keep each key funded with only a few days of gas, plus a low-balance alert.
- Mainnet hardening (Phase 6): change `StakePool` to accept **EIP-712-signed verdicts that anyone can submit**. Then the referee key never needs ETH, can live in a KMS or hardware signer, and can be rotated behind a timelock.

**Accounts.** 2FA (passkey or authenticator app, not SMS) on GitHub, Cloudflare, Vercel, Google (Gemini key), Coinbase Developer Platform and the RPC provider. Taking over any of these accounts means taking over a key.

**Referee API**
- `ADMIN_KEY`: 32+ random bytes, compared in constant time. Admin and override routes only.
- Rate-limit `/goals/compile` and `/goals` per IP (Cloudflare free rate-limit rule, plus Turnstile on compile) so nobody can burn the free Gemini quota or fill the DB.
- CORS: browser routes allow only the Vercel origin. `/x402/*` stays open (it's a public paid API).
- Keep every existing defense: untrusted evidence quoted as data (`quote()`), schema-constrained output, failing closed when a model call fails, first-seen timing, control proofs.
- The Gemini key has its own Google Cloud project with a quota cap. Free-tier prompts may be used by Google; only public evidence is sent, never secrets.
- `GITHUB_TOKEN`: a fine-grained token with read-only public access. Canvas stays off in production (its token is a real university account).

**Supply chain.** Pin dependency versions (lockfile committed), run `pnpm audit` before each deploy, and turn on Dependabot alerts. No secrets in GitHub Actions logs.

**Before each deploy:** `git log -p` secret scan, `pnpm --filter redteam referee`, and check that the Worker and Vercel env lists contain nothing unexpected.

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
