# PIVOT.md: Groups, a prediction-market feature for school work

Written Sun Oct 11, ~3:00 PT. **Groups is a feature on top of the existing product, not a replacement.** The core stays as it is: anyone puts AUSD behind any task with checkable evidence, and the AI referee settles it on-chain. Groups adds a social layer for school work. PLAN.md is human-owned; this file is the proposal for that addition.

## 1. The feature in one paragraph

Three friends form a **group**. Each term they put their school work on the board: assignments, test scores, project milestones. Every item becomes a small **market** ("Will Maya submit the CS61B project by Friday?", "Will Leo score 85+ on the stats midterm?"). You bet **on yourself**; your friends can bet **against you**. An AI referee gathers the evidence itself and settles each market on-chain. There is **no house and no fee**: every AUSD that goes in stays in the group and is paid out to whoever was right.

Group projects work the same way: the project is split into three tasks, one per member, and each task is its own market. The group as a whole wins when everyone delivers; whoever drops their part pays the others.

## 2. Rules that keep it fair

| Rule | Why |
|---|---|
| You can only bet YES on your own markets, never NO | Betting against yourself pays you to fail on purpose. |
| Friends can bet NO on you, up to a cap (e.g. 2x your own YES stake) | Keeps it a nudge, not a way to farm a friend who is struggling. |
| A market opens only after its owner accepts it | Nobody puts your grades on a board without consent. |
| The referee gathers evidence itself: no screenshots, no self-reported scores | Same trust model as today: uploads and claimed timestamps are ignored. |
| No verdict by the settle time means everyone is refunded | A referee outage never costs anyone money. |
| Grades are reduced to a yes/no against the threshold; raw grades are never stored or shown | Grades are sensitive student records. |
| Members only, max group size 3 for the demo | It is a friend group, not a public casino. |

Integrity safeguards (control proofs, first-seen timing, two-model substance check, prompt-injection hardening, on-chain verdict hashes) run behind every market. They are not a feature to play with; see the Integrity page.

## 3. What exists today vs. what is new

**Already built and proven (CP2 passed 21:48Z, verdict tx `0xb7dc5613…e19743`):**

- Stake in AUSD with gasless ERC-3009 signatures, relayer pays gas (Base Sepolia).
- AI referee: compiles plain-text tasks into exact criteria, watches GitHub repos and live URLs, rules with reasons, two models must agree on substance, posts verdict + evidence hash on-chain.
- Contract with no owner withdrawal; passers split forfeits; no verdict = refund.
- Web: in-browser wallet, stake flow, verdict page that re-verifies hashes against the chain, live cohort board with QR, integrity page.

**Mapping the pivot onto what exists:** a *cohort* is a *group*; each member's goal is their *market*; "passers split the forfeits" is already "bet on yourself, money stays in the group". This part works today with no contract change.

**New work, in priority order:**

| # | Change | Owner | Effort | Today? |
|---|---|---|---|---|
| 1 | Web: rename cohort to group, show members and their tasks, group invite link + QR, "split a project into 3 tasks" form | C | 45 min | Yes |
| 2 | Relayer: public `POST /groups` that creates a cohort (so friends start their own group) | A | 20 min | Yes |
| 3 | Contract: `MarketPool` with YES/NO pools per market (parimutuel: winners split losers' pool pro rata, no fee) so friends can bet against you | A | 90 min + tests | Risky before 4:20 freeze |
| 4 | Referee: `canvas_grade` evidence type (score >= threshold), read with the student's own consented, read-only token | B | 60 min + privacy review | No (PLAN keeps Canvas to the team's own account) |
| 5 | XRPL settlement rail (section 5.3) | new owner | 60-90 min | Only if the human team accepts a second chain |

Recommendation for the 4:20 freeze: ship 1 and 2, demo test-score markets using the team's own Canvas account (already allowed), and present 3 and 4 as the next build. Do not hard-code outcomes anywhere; judges require real functionality.

## 4. How a market resolves

| Market type | Evidence the referee reads | Status |
|---|---|---|
| Project or coding task | Commits first seen in the window on a public repo, nonce file for control | Live |
| Something published | Page goes live with the promised content, nonce on page | Live |
| Assignment submitted | Canvas submission state, time, attachment size | Team account only |
| Test or assignment score >= X | Canvas grade via the student's own token, reduced to yes/no | New (row 4) |

## 5. Sponsor tracks

Requirements that apply to all tracks: built during the hackathon, real (not hard-coded) core functionality, public GitHub repo, 2-minute YouTube demo, live deployment link recommended.

### 5.1 Best Use of AUSD (Agora): **primary track, strong fit**

- Every stake, bet and payout is AUSD on Base Sepolia, moved with **ERC-3009 `ReceiveWithAuthorization`**, so students never hold gas. Already working end to end.
- Money never leaves the group: a closed-loop AUSD pot with no operator withdrawal.
- **x402 (to add, ~30 min, B):** the referee's verification API is offered to *third-party* apps behind HTTP `402 Payment Required`, paid per request in AUSD via ERC-3009. Groups never pay this; it is how the referee would fund itself without taking a cut of anyone's pot. This is the "agentic payments" angle the track asks for.

### 5.2 YZi Labs (Programmable Capital, Intelligence & Science): **good pitch fit, chain question**

- Fits "agents that can transact and be trusted" and "tamper-evident logs": an AI agent decides who gets paid, and every decision is hashed on-chain and re-verifiable in the browser.
- Real bottleneck: commitment and study groups fail because nobody enforces them; the referee does, without a human judge.
- **Open issue:** the track's setup says deploy on BSC Testnet or opBNB. We are on Base Sepolia. The human team should ask the YZi table whether Base Sepolia counts (PLAN.md section 10). If not, A redeploys `StakePool` on BSC Testnet with a test token (~30 min; AUSD may not exist there).

### 5.3 Best Use of Ripple (XRPL): **possible, needs a decision**

Design that combines several XRPL primitives into one flow:

| Need | XRPL feature |
|---|---|
| Lock each member's stake until resolution | **Escrow** with a crypto-condition (PREIMAGE-SHA-256) |
| No verdict means refund | Escrow `CancelAfter` returns the stake automatically |
| Group pot nobody can drain alone | Pot account with a **SignerList** (multisig: members + referee) |
| Pay all winners atomically | **Batch** transaction (XLS-56) |
| Stable stakes | **RLUSD** via **TokenEscrow** (XLS-85), else XRP |
| Members only | **Credentials** (XLS-70), optional |

Flow: each member escrows their stake to the pot; only the referee knows the fulfillment and reveals it only when that member *fails*, which moves the stake into the pot. Pass, or no verdict, and `CancelAfter` refunds the member. The pot then pays the winners in one Batch. The referee is unchanged; its verdict drives XRPL transactions in addition to Base Sepolia.

Costs: 60-90 min for one agent (adapter + script running a 3-person group on testnet); breaks PLAN.md's "no second chain" rule; Batch and TokenEscrow availability on testnet must be checked first. Submission needs a working testnet MVP, a public repo with a detailed README, and optionally the developer feedback form ($100 bonus).

### 5.4 Best Use of Gemini Prediction API: **weak fit, skip unless time allows**

Our markets are private group markets settled by the referee; Gemini's API serves public event markets. The only honest integration would be letting a group also trade a public Gemini sandbox market from the same screen (needs a sandbox account and API key from the human team). Recommend not targeting this track.

### 5.5 Bonus: Context.dev: **reasonable fit**

The referee could use Context.dev website monitoring and scraping to watch published pages and course sites instead of raw fetches. Owner B, ~45 min. Optional.

### 5.6 Bonus: ElevenLabs: **light fit**

Read verdicts aloud on the group board ("Leo passed his midterm market; Maya and Sam split 20 AUSD"). ~20 min in the web app. Optional, purely for the demo.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Reads as gambling on grades | Testnet only; framed as accountability among friends; no house, no fee, money stays in the group; caps on betting against friends. |
| Incentive to cheat on the test itself | Out of the referee's sight. Markets are on outcomes the school already polices; we state this plainly. |
| Grade privacy | Consent per market, read-only token, only yes/no stored, nothing shown publicly. |
| Sandbagging | You cannot bet against yourself. |
| Friend pile-on | NO bets capped relative to the owner's own stake. |
| Scope creep before freeze | Ship rows 1-2 of section 3; everything else is roadmap. |

## 7. Demo script (2 minutes)

1. **0:00** Three friends, one group, three tasks: Maya's project, Leo's midterm, Sam's essay. Each bets 10 AUSD on themselves.
2. **0:20** Leo's friends bet that he won't hit 85. The pot stays inside the group.
3. **0:40** A backdated commit is rejected: the referee only counts what it saw happen.
4. **1:00** Deadline. Verdicts post on-chain with reasons; the browser re-verifies each hash.
5. **1:30** Settle: whoever was right is paid in AUSD, gaslessly. No house, no fee.
6. **1:50** Close on the Integrity page and the results of our own attack tests.

## 8. Decisions needed from the human team

1. Adopt Groups as a feature and add it to PLAN.md (the core product description stays)?
2. Allow a second chain for the Ripple track, and who owns `xrpl/`?
3. Ask the YZi table about Base Sepolia vs. BSC Testnet.
4. Attempt `MarketPool` (betting against friends) before the freeze, or keep it as roadmap?
