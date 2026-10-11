# Handoff: Cash Cow (B@BHacks 2.0), Agent C / web

Paste this into a new chat to continue the work. Date: Sun Oct 11 2026, around 3:35 PT. **Code freeze is at 4:20 PT.**

## 1. The project

**Cash Cow.** You put testnet AUSD behind any task with a deadline. An AI referee gathers the evidence itself, rules pass or fail with reasons, and posts the verdict on-chain where anyone can check it. Stakes from missed tasks go to the people who finished. The operator has no way to withdraw.

- **Evidence types today:**
  - commits pushed to a public GitHub repo;
  - a public page going live with the promised content;
  - Canvas assignment submitted (the team's own account only).
- **Groups:** a feature on top of the core product, for school work.
  - Three friends split a project three ways, and each one stakes on their own part.
  - **Two separate pots per task:**
    - the owner's commitment stake (live): lost if they miss, and it goes to the friends who delivered;
    - a public YES/NO market (not built yet): needs a `MarketPool` contract. The owner can't bet NO on themselves, and the market never touches the owner's stake.
- **Integrity:** "Fool the Ref" is NOT a product feature and must never be marketed or gamified. Anti-cheat safeguards run behind the scenes, and the Integrity page shows them as trust evidence. Red-team result: 12 attacks caught, 0 missed.
- **Sponsor tracks:**
  - Best Use of AUSD (primary): ERC-3009 stakes, plus x402 paid referee API.
  - YZi Labs: a trusted agent that moves money. Open question: Base Sepolia vs. BSC Testnet.
  - General (Most Creative).
  - Ripple/XRPL: escrow design exists in `docs/PIVOT.md` §5.3; needs the human team to approve a second chain.

## 2. Team and ownership (from `PLAN.md`, which only humans edit)

- **Agent A:** `contracts/`, `relayer/`, `redteam/`.
- **Agent B:** `referee/`.
- **Agent C (me):** `web/`, `README.md`, `docs/`.
- **Other areas:**
  - `shared/` changes need a PR plus acks from the others.
  - Requests to other owners go in GitHub issues labelled `needs:A` or `needs:B`.
  - Team chat and coordination happen on issue #1.
- **Repo:** `github.com/cabbles/b-bhacks`. I've been pushing directly to `main` (latest: `8b56d29`). My working branch is `agent-c`.

## 3. Stack and deployed pieces

- **Monorepo:** pnpm 9.12.0 workspaces (`npx --yes pnpm@9.12.0 ...`). Packages: `shared`, `referee`, `relayer`, `redteam`, `web`, plus `contracts` (Foundry).
- **Chain:** Base Sepolia (84532).
  - StakePool: `0x1470af4526f820DC7Ca5bE70cA77bBf2400e76f9`.
  - AUSD: `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals, EIP-712 domain "Agora Dollar" v1.
  - Referee signer: `0x57CB6D4f98979403D89A6c2d6A7c17ef4D54eD3B`.
- **Relayer (Agent A):** `https://pattern-css-build-plates.trycloudflare.com`. Routes `/config`, `/drip`, `/stake`, `/claim`.
- **Referee (Agent B):** `https://hamster-visitor-anyplace.ngrok-free.dev`. Every request needs the header `ngrok-skip-browser-warning: 1`.
  - x402: `POST /x402/verify` costs 0.10 AUSD via ERC-3009 `TransferWithAuthorization`; `GET /x402` lists the price.
- Both service URLs are in `shared/deployments.json`.

**Stake signing:**
- ERC-3009 `ReceiveWithAuthorization` with `to` = pool and `nonce = keccak256(abi.encode(cohortId, goalHash))`.
- `goalHash` and `evidenceHash` are `keccak256(toBytes(canonical(x)))`, using `shared/canonical.ts`.

**Contract reads:**
- `stakes(cohortId, staker)` returns `(goalHash, outcome, claimed)`, where outcome 1 = passed, 2 = failed.
- `claimable(cohortId, staker)`.
- Event `Verdict(cohortId indexed, staker indexed, passed, evidenceHash)`.

## 4. The web app (`web/`)

**Stack:** Next.js 14.2.15 (app router, `experimental.externalDir`), Tailwind 3.4, viem 2.21. Path aliases: `@shared/*` → `../shared/*` and `@redteam/*` → `../redteam/*`. React Bits components are copied in as source under `components/reactbits/`: SplitText, CountUp (patched so it always ends on the correct number), DecryptedText, ClickSpark.

**Design brief:**
- Look: Swiss utility, slate-black, one accent colour used on under 10% of the screen, asymmetric layouts.
- Fonts: Space Grotesk, IBM Plex Sans, IBM Plex Mono.
- Banned: purple/blue gradients, glowing blobs, 3-card grids, icon circles, copy heavy with em-dashes.
- Tokens: ink `#0D0F12`, panel `#13161B`, line `#262A31`, fg `#ECEDEE`, muted `#8A8F98`, accent/pass `#C6FF3D`, fail `#FF5A4E`, human `#FFB020`.

**Wording:**
- Say "Market", not cohort or group, and "stake" as the verb.
- "Bet on yourself." appears only on the group-invite stake page.
- No QR codes ("it's a market"). Everything on the site has to be intentional.

**Routes:**
| Route | What |
|---|---|
| `/` | Pitch ("Do it, or pay." / "A referee that checks."), 6-point list, browser wallet + faucet, open markets, your goals |
| `/stake?cohort=N[&task=...]` | Commit to a task: compile criteria with the referee, control proof, sign ERC-3009, relay |
| `/split` | Groups: split a project into 3 tasks; each task gets an invite link |
| `/cohorts/:id` | Market board: countdown or state, pot, terms, stakers and their tasks |
| `/goals/:id` | Verdict (PASS/FAIL), numbered checks, the browser re-verifies 4 things against the chain, payout/claim |
| `/integrity` | 7 safeguards, red-team results (12/0), attack tables |
| `/status` | Pre-flight checks (not in the nav) |
| `/fool` | Redirects to `/integrity` |

**Main `lib/` files:**
- `api.ts`: relayer and referee clients, with the tunnel header and mock fallbacks.
- `erc3009.ts`: stake signing.
- `verify.ts`: on-chain re-verification.
- `wallet.ts`: burner key in localStorage, one drip per relayer.
- `fixtures.ts`: mock mode.

**Mock mode:**
- Each service falls back to fixtures independently when it has no URL.
- `NEXT_PUBLIC_MOCK=1` forces fixtures for both.
- Mock goals are judged after 20 seconds.

**Run it:** `cd web && pnpm dev` (port 3000). `pnpm test:sig` checks that signatures recover to the staker. Before pushing, verify with `next build` in a separate git worktree (the dev server and the build share `.next`).

## 5. What's proven

**CP2 passed end to end on testnet, through the UI:**
- Stake: `0x46595f232f709a609563d2beb6b30a13895839718dada3ffe36c79995c55777f`.
- Verdict PASS: `0xb7dc56131698c75292b737bbaa23cdf403f0ad52f01709d271ed19c62ee19743`.
- Browser re-verification: 4 of 4 checks match.
- Claim: `0xec141589c747d7f6101f63c58307f0ef972909d1fd6b3f660a4a93f946d2a844`. The wallet went from 90 to 100 AUSD.
- Full log: `docs/cp2.md`.

## 6. Docs in the repo

- **`README.md`:**
  - intro, "What makes it different" (4 points, the 4th is x402), and Groups;
  - sponsor-track table, How it works, run/deploy instructions, routes;
  - CP2 proof table, Live results (**TBD, fill in at freeze**), red-team table, Safety.
- **`docs/PIVOT.md`:** the Groups proposal (two-pot model, sponsor-track mapping, XRPL design, risks, 2-minute demo script, decisions for the humans).
- **`docs/demo-script.md`:** the demo beats. Screenshots have to be captured in a real browser; headless Chrome can't reach the tunnels.

## 7. Open items, by priority

1. **CP3 needs a public web URL.** Not done. Options:
   - Vercel: Root Directory = `web`; set `NEXT_PUBLIC_REFEREE_URL`, `NEXT_PUBLIC_RELAYER_URL` and `NEXT_PUBLIC_WEB_URL`.
   - On a laptop: `WEB_TUNNEL=cloudflared web/scripts/run-live.sh`.
2. **Canvas demo (Alara / Agent B):**
   - Add `CANVAS_TOKEN` and `CANVAS_ALLOWED_STAKERS=<demo wallet>` to `referee/.env` on the referee host, then restart the referee.
   - Pick an open assignment and stake in Market #3 using the "Canvas assignment submitted" option. Staking closes at 3:50 PT.
   - Submit the assignment before the 4:05 PT deadline.
   - **The Canvas token must never be committed or pasted anywhere public. Revoke it after the event.**
3. **MarketPool (YES/NO market):** asked Agent A on issue #1 whether it lands before 4:20. If they post an ABI and address, add a YES/NO panel to `/goals/:id` that resolves from `StakePool.stakes().outcome`. Otherwise it stays roadmap: no fake UI without a contract behind it.
4. **At the 4:20 freeze:** fill in the README Live results (real stakers, verdicts posted on-chain, human overrides). Capture screenshots in a real browser.
5. **Human decisions still pending:** whether to adopt Groups in `PLAN.md`; Ripple / a second chain; whether YZi accepts Base Sepolia; whether to attempt `MarketPool`.
6. **Hackathon requirements:** public GitHub repo, 2-minute YouTube demo, live deployment link.
