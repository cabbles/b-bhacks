# Deploying Cash Cow

Everything runs on free plans, with nothing on a laptop:

| Piece | Where | What it does |
|---|---|---|
| Web app (`web/`) | **Vercel** (Hobby) | The site. Users connect their own wallet and send their own transactions. Reads the contracts directly. |
| Referee (`referee/`) | **Cloudflare Workers** + **D1**, cron every minute | Compiles goals, watches evidence, posts verdicts (referee key), and pays everyone out (keeper key). |
| Models | **Gemini API**, free key | Goal compiling and the two substance judges. |
| Contracts (`contracts/`) | **Base Sepolia** | `StakePool`, `MarketPool`, `CommitmentBond`. Test AUSD from Agora's faucet. |
| Gas sponsorship (optional) | **Coinbase Developer Platform** paymaster | Passkey (Base Account) users pay no gas. |

Testnet only. Nothing here holds real value, and the free Gemini tier may use prompts to improve Google's products (the referee only sends public evidence).

## 0. Accounts

Create these, and turn on two-factor auth (an authenticator app or passkey, not SMS) for each one. Taking over any of them means taking over a key or the site.

- GitHub (already have), Cloudflare, Vercel, Google AI Studio, Coinbase Developer Platform, and optionally Alchemy (a keyed RPC; the public `sepolia.base.org` is rate-limited).
- Install Foundry (`forge`, `cast`) and pnpm.

## 1. Keys

Three wallets, each with one job. Each is an **encrypted keystore** (password prompt), so no private key is ever printed or written in plain text:

```bash
cast wallet new cashcow-deployer -p   # deploys the contracts; no special rights afterwards
cast wallet new cashcow-referee -p    # posts verdicts; becomes the referee baked into StakePool
cast wallet new cashcow-keeper -p     # pays gas for settle and payouts (anyone may call those)
cast wallet address --account cashcow-referee   # repeat for each: proves the password works
openssl rand -hex 32                  # ADMIN_KEY: store it in your password manager
```

`-p` asks for the password only once and never confirms it, so a typo goes unnoticed: create each password in a password manager first, paste it, then check it with `cast wallet address` right away. Keep the passwords in the password manager. Fund all three with a little Base Sepolia ETH from a faucet (e.g. the Coinbase Developer Platform faucet); `cast wallet address --account cashcow-keeper` prints an address.

Why a fresh referee key: the hackathon one lived on a laptop behind tunnels, and the contracts are being redeployed anyway, so rotating it costs nothing now. It can't be rotated later without another redeploy.

## 2. Contracts

```bash
cd contracts
REFEREE_ADDRESS=$(cast wallet address --account cashcow-referee) \
  forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast --account cashcow-deployer
node scripts/export.mjs     # writes the three addresses + ABIs into shared/
```

Commit `shared/deployments.json` and `shared/abi/`. Optional sanity check against real AUSD: `FORK_RPC_URL=https://sepolia.base.org forge test --match-contract Fork`.

## 3. Referee on Cloudflare Workers

```bash
cd referee
pnpm exec wrangler login
pnpm exec wrangler d1 create cashcow-referee     # put the printed database_id into wrangler.jsonc
pnpm cf:deploy                                    # prints https://cashcow-referee.<you>.workers.dev
```

Secrets, passed along without ever showing on screen (each prompts for the keystore password). The key is decrypted first and uploaded only if that worked; piping straight into wrangler would upload an empty secret after a wrong password:

```bash
K=$(cast wallet decrypt-keystore cashcow-referee | grep -oE '0x[0-9a-fA-F]{64}') && [ -n "$K" ] && printf '%s' "$K" | pnpm exec wrangler secret put REFEREE_PRIVATE_KEY; unset K
K=$(cast wallet decrypt-keystore cashcow-keeper  | grep -oE '0x[0-9a-fA-F]{64}') && [ -n "$K" ] && printf '%s' "$K" | pnpm exec wrangler secret put KEEPER_PRIVATE_KEY; unset K
pnpm exec wrangler secret put GEMINI_API_KEY      # from aistudio.google.com; give it its own Google Cloud project with a quota cap
pnpm exec wrangler secret put GITHUB_TOKEN        # fine-grained token, public repositories read-only, no other scopes
pnpm exec wrangler secret put ADMIN_KEY
pnpm exec wrangler secret put RPC_URL             # e.g. your Alchemy Base Sepolia URL (it embeds a key, so it's a secret)
```

Check: `curl https://cashcow-referee.<you>.workers.dev/health` shows `chain`, `signer`, `signer_matches_pool`, `models`, `keeper` and `github` all `true`, and the two public addresses are the ones you expect. `signer_matches_pool: false` means the referee key is not the referee written into StakePool, so every verdict would be refused.

Canvas stays off in production (its token is a real university account): don't set `CANVAS_TOKEN`.

## 4. Gas sponsorship (optional, recommended)

In the Coinbase Developer Platform, create a project and open **Paymaster** on **Base Sepolia**. Its URL (`https://api.developer.coinbase.com/rpc/v1/base-sepolia/...`) is visible to every visitor, so the policy is what protects it:

- **Allowlist only these contracts and functions:** StakePool (`stake`, `createCohort`, `claimFor`), MarketPool (`bet`, `resolve`, `claimFor`), CommitmentBond (`bond`, `resolve`, `claimFor`), AUSD (`approve`), and the Agora faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (`requestFunds`).
- **Set per-user limits** (operations and gas per user per day).

Without it, everything still works; every wallet just pays its own (free, test) gas.

## 5. Web app on Vercel

Import the GitHub repo. **Root Directory** `web` (leave "Include files outside the root directory" on, the app imports `../shared`). Environment variables:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_REFEREE_URL` | the `workers.dev` URL from step 3 |
| `NEXT_PUBLIC_RPC_URL` | a Base Sepolia RPC for the browser. A keyed URL is public: in Alchemy, restrict the key to your Vercel domain. |
| `NEXT_PUBLIC_PAYMASTER_URL` | from step 4 (optional) |
| `NEXT_PUBLIC_WEB_URL` | your Vercel URL, for invite links |

Then lock the referee to the site: set `"CORS_ORIGINS": "https://<your-app>.vercel.app"` in `referee/wrangler.jsonc` and run `pnpm cf:deploy` again. Put both URLs into `shared/deployments.json` (`referee_url`, `web_url`) and commit.

Vercel Hobby is for non-commercial use. If this becomes a business, move to Vercel Pro or host the web app elsewhere.

## 6. Check it end to end

1. Open `/status` on the site: every row green.
2. Connect a wallet, **Get test AUSD**, create a market with the shortest times, stake on a real task, and bet from a second browser.
3. After the deadline: the verdict posts within a few minutes, and about 11 minutes after the deadline the keeper settles and pays everyone automatically (`pnpm exec wrangler tail` shows `[keeper] ...` lines).
4. Red team, against the live system: `REDTEAM_PRIVATE_KEY=...` (a funded throwaway) `pnpm --filter redteam onchain` and `pnpm --filter redteam referee`, then `pnpm --filter redteam report`.

## Running it

- **Logs:** `cd referee && pnpm exec wrangler tail`.
- **CPU limits:** the free plan gives each request and each cron run 10 ms of CPU and 50 outbound requests. Each run does bounded work (`KEEPER_MAX_SENDS`, `KEEPER_MAX_CHUNKS`, and caps on polls and decisions) and leaves the rest for the next minute. If the Workers dashboard shows CPU-limit errors, lower those, or move the referee to Vercel + Turso + an external cron: the code is runtime-neutral (`src/app.ts`), so only the entry point and the database backend change.
- **Gas:** keep a few days of Base Sepolia ETH on the referee and keeper wallets.
- **Admin:** `REFEREE_URL=https://cashcow-referee.<you>.workers.dev ADMIN_KEY=... pnpm --filter referee admin` lists goals needing a human; `admin pass|fail <id> "note"` overrides (counted publicly).
- **Before each deploy:** `pnpm -r typecheck`, `pnpm --filter referee test`, `cd contracts && forge test`, `pnpm audit`, and a look at `git log -p` for anything that looks like a key.

## Mainnet is a different project

Going to mainnet changes what's at stake, not just a setting: real AUSD and real gas, contracts that hold real money (get them audited), the referee key moved to a hardware or KMS signer (ideally with verdicts signed off-chain so it never holds ETH), a paid model key with two different vendors, and legal advice first, because betting on whether people finish tasks is likely regulated as gambling or a prediction market. See `docs/deploy-plan.md`, Phase 6.
