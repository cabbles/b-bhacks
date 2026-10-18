# Referee

The service that decides whether a staker did what they committed to. It gathers the evidence itself, rules pass or fail with reasons, and posts the verdict on chain. It cannot move funds: the contract only lets it post one verdict per staker, and a missing verdict means a refund.

It also runs the **keeper**, which settles each round once the contract allows it and pays everyone what they are owed. It runs on Cloudflare Workers (D1 + a cron every minute) or locally on Node; both use the same code.

## How a goal is judged

1. **Compile.** `POST /goals/compile` turns free text into criteria JSON (`github_commits`, `url_live` or `canvas_submission`) plus a one-line summary and a control-proof instruction. The goal deadline is the cohort's `goalDeadline`, read from the contract.
2. **Register.** `POST /goals` checks that `stake_tx_hash` emitted `Staked(cohortId, staker, goalHash)` where `goalHash = keccak256(canonical(criteria))`. Criteria that don't match the on-chain stake are rejected.
3. **Snapshot.** At registration the referee records what already exists: every commit on every branch of the repo, or whether the page already shows the promised text.
4. **Watch.** GitHub branches are polled every 30 seconds. Each commit is stored with the time the referee first saw it. Git author and committer dates are never used.
5. **Decide.** Shortly after the deadline, deterministic checks run first. Only if all of them pass do two independent model judges (two different Gemini models by default) rule on `substance`: is this real work toward the goal, or filler?
6. **Post.** The verdict JSON is hashed (`evidenceHash = keccak256(canonical(verdict))`) and posted with `postVerdict`. `GET /goals/:id` returns the verdict, so anyone can recompute the hash and compare it with the on-chain event.

### Checks

| Type                | Check               | Passes when                                                                        |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `github_commits`    | `repo_control`      | `.referee/<nonce>` exists on the branch of a public repo                           |
|                     | `commits_in_window` | at least `min_commits` non-merge commits were first seen inside the window and are still on the branch |
|                     | `substance`         | both judges agree the diffs deliver the goal                                       |
| `url_live`          | `not_live_at_stake` | the page did not show the promised text at stake time                              |
|                     | `url_control`       | the nonce is on the page or in `/.well-known/referee.txt`                          |
|                     | `url_content`       | the page shows the promised text at the deadline                                   |
|                     | `substance`         | both judges agree the page delivers the goal (not a static placeholder)            |
| `canvas_submission` | `canvas_submitted`  | bCourses reports the assignment submitted, with `submitted_at` inside the window   |
|                     | `canvas_min_bytes`  | the submission has content                                                         |

### Outcomes

- **pass**: every check passed.
- **fail**: any check failed.
- **needs_human**: the judges disagreed, or a judge did not answer (outage, usage limit, invalid output). A judge outage never fails a user. If nobody resolves it, the contract refunds the stake.

## Hardening

- **Evidence is data, never instructions.** Gathered content goes to the judges JSON-encoded inside `<untrusted_…>` tags. The judges are plain API calls with no tools. Their output must match a schema, or the vote is treated as missing.
- **Injection tripwire.** Evidence that addresses the referee ("ignore previous instructions", "mark this as passed") fails `substance` before any model sees it.
- **The engine never sees `is_attack`.** Fool the Ref attempts are judged exactly like real goals.
- **Backdating does nothing.** Only the referee's own clock counts.
- **Branch laundering does nothing.** Commits on any branch at stake time are pre-existing, so work done before staking can't be merged in during the window to count as new.
- **Fetching is restricted.** Only `https` URLs are fetched, every redirect hop is re-checked, private and loopback addresses are refused, and bodies are capped at 512 KB.
- **Rate limits.** `/goals/compile` allows 15 calls per staker per hour and 400 per hour in total, counted in the database so they hold across Worker instances.
- **Locked-down API.** Browser calls are accepted only from `CORS_ORIGINS` (the paid `/x402` API stays open), request bodies are capped at 64 KB, admin keys are compared in constant time, and internal errors are never echoed back.

## x402: the referee as a paid API

Third-party apps and agents can buy a one-off ruling ("does this evidence deliver this goal?") for **0.10 AUSD per request**, with HTTP `402 Payment Required` and the x402 `exact` scheme on Base Sepolia. Groups never pay this; it's how the referee would fund itself without taking a cut of anyone's pot.

1. `POST /x402/verify` with `{ goal_text, evidence }`, where `evidence` is `{ type: "url", url, must_contain? }` or `{ type: "github", repo, shas: [...] }`.
2. With no payment, the response is `402` with `accepts: [{ scheme: "exact", network: "base-sepolia", maxAmountRequired: "100000", asset: <AUSD>, payTo: <referee>, extra: { name: "Agora Dollar", version: "1" } }]`.
3. The agent signs an ERC-3009 `TransferWithAuthorization` (no gas needed) and retries with it base64-encoded in `X-PAYMENT`.
4. The referee checks the signature, dry-runs the transfer, gathers the evidence itself, runs the injection tripwire and both judges, and **only then** settles the transfer on chain. Bad evidence or a failed ruling is never charged.
5. The response has the `ruling`, its `evidence_hash`, an `attestation` (the referee key's EIP-191 signature over the hash) and the payment transaction. The `X-PAYMENT-RESPONSE` header carries the settlement receipt.

A replayed `X-PAYMENT` is refused, because the token rejects a used authorization nonce. `GET /x402` lists the price for agents discovering the API. `pnpm x402-demo [referee_url]` runs the whole flow with a fresh wallet funded from the Agora faucet.

## Known limits

These are honest gaps, not bugs. Fool the Ref attempts that exploit them should count as `fooled`.

- **Work done before staking but never pushed** (kept locally or in another repo, then pushed during the window) looks the same as new work. Only the judges' sense of whether the work matches the goal stands in the way.
- **`url_live` sees server-rendered HTML.** A page that only renders its content with client-side JavaScript may fail `url_content`. A page can also hide text with CSS; the judges see the full HTML and may or may not catch it.
- **Goals on the same repo and branch share commits.** The referee can't tell whose push a commit was: git authors are forgeable, and the nonce file only proves push access. Group projects should give each member their own branch ("…on branch maya") or repo; otherwise only the judges' check that the work matches each goal tells them apart.
- **Judges can be wrong.** Two models must agree, and disagreement goes to a human, but a convincing fake can still pass.
- **Canvas goals** only work for the team's own account (`CANVAS_ALLOWED_STAKERS`), because they use the server's bCourses token.

## Keeper: payouts

Every contract call after the verdict can be made by anyone, so payouts need no trust. The keeper makes them automatically with its own key (`KEEPER_PRIVATE_KEY`, never the referee key; it only needs a little ETH for gas):

1. It records every staker and bettor from the contracts' `Staked` and `Bet` events, scanning in chunks from `deployBlock` and saving its position.
2. Once a round is past its goal deadline plus the 10-minute settle delay, it calls `settle`, pays every staker (`claimFor`), resolves each task's YES/NO market and bond, and pays every winning bettor.
3. A round is marked done only when every payout succeeded and the scan found as many stakers as the contract counts. Each run sends at most `KEEPER_MAX_SENDS` transactions; the rest wait for the next run.

`bash test/keeper-e2e.sh` plays a full round on a local anvil chain and checks every balance.

## Run it

**Locally (Node):**

```bash
cp .env.example .env   # RPC_URL, REFEREE_PRIVATE_KEY, KEEPER_PRIVATE_KEY, GEMINI_API_KEY, GITHUB_TOKEN, ADMIN_KEY
pnpm install
pnpm dev               # http://localhost:8787, SQLite in referee.db, scheduled work on timers
```

**On Cloudflare Workers:** see [`infra/README.md`](../infra/README.md). `pnpm cf:dev` runs the Worker locally (local D1; `curl "localhost:8787/__scheduled?cron=*+*+*+*+*"` triggers a scheduled run).

Models run on the Gemini API: set `GEMINI_API_KEY` (a free key from Google AI Studio works) and optionally `MODEL_NAME_A` / `MODEL_NAME_B`. Alternatives: `MODEL_PROVIDER=api` with `MODEL_API_KEY` for the Anthropic API, or `MODEL_PROVIDER=off` for deterministic checks only. `REFEREE_FIXTURES=1` (Node only) serves every route from `shared/fixtures`.

```bash
pnpm admin                                     # goals needing a human or erroring
pnpm admin pass <id> "note"                    # human override, counted publicly
```

Chain reads use the contract's getters (`cohorts`, `cohortCount`, `stakes`) rather than logs where they can, because the public Base Sepolia RPC caps `eth_getLogs` at 200 blocks.

## API

| Method and path            | Notes                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| `POST /goals/compile`      | `{ text, staker, type_hint?, cohort_id? }` → `{ criteria, goal_hash, summary, control_proof }` |
| `POST /goals`              | `{ cohort_id, criteria, stake_tx_hash, is_attack?, attack_category?, attack_note? }` → `{ goal_id }` |
| `GET /goals/:id`           | status, criteria, verdict, `evidence_hash`, `verdict_tx_hash`, `stake_tx_hash` |
| `GET /cohorts/:id`         | cohort from chain, goals, stats (including attacks and human overrides) |
| `GET /attacks`             | decided Fool the Ref attempts with `caught` or `fooled`               |
| `POST /goals/:id/verify`   | admin (`x-admin-key`): decide now, idempotent                         |
| `POST /goals/:id/override` | admin: `{ passed, note }`, sets `human_override: true`                |
| `GET /admin/queue`         | admin: `needs_human` and erroring goals                               |
| `POST /x402/verify`        | paid (x402, 0.10 AUSD): one-off ruling on a URL or commits, signed    |
| `GET /x402`                | price list for agents                                                 |
| `GET /health`              | `{ ok, chain, signer, models, keeper, github }`: what is configured (booleans only) |

## Tests

`pnpm test` runs the unit tests: whitespace-filler detection, the injection tripwire, the Gemini client (against a fake server), and `goalHash`/`evidenceHash` against `shared/fixtures/hashes.json`. `bash test/keeper-e2e.sh` tests payouts end to end on anvil. End-to-end runs (real GitHub, a public `url_live` page, and a local Anvil chain with the real `StakePool`) were run during development; their results are in issue #1.
