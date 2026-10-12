# Demo outline: video and live (about 3 minutes)

**One message:** put money on your task, and an AI referee you can't fool decides whether you did it. There are two ways to play: **bet on yourself** (solo stake), or **bet on someone** (a market on one person's task).

Site: https://lion-browsing-princess-legends.trycloudflare.com. If the host laptop restarts, the link changes; `shared/deployments.json` always has the current one.

Use two devices: the **laptop** is the task owner and the **phone** is a bettor. Each browser gets its own wallet and 100 test AUSD the first time it opens the site.

## Flow

| # | Time | Screen | What it shows | Say |
|---|------|--------|---------------|-----|
| 1 | 0:00–0:15 | Home `/` | The two cards: **Bet on yourself** and **Bet on someone** | "Everyone says they'll ship it this weekend. Cash Cow makes you put money on it, and an AI referee checks whether you did." |
| 2 | 0:15–0:45 | **Make a solo stake** `/stake` | Type a goal, then show **The referee will check** and **Exact criteria, frozen at stake time**, then press **Stake** | "Plain words become exact criteria, frozen when I stake. One signature, and the relayer pays the gas, so I never need ETH. If I deliver, I get my stake back plus a share of what people who missed theirs lost. If I miss, I lose it." |
| 3 | 0:45–1:15 | **Create a market** `/cohorts/new` | Fill in **Your task** and **Your stake**, create it, then **Copy link** | "Or let other people bet on me. My stake is separate from theirs. If I finish, I get exactly my stake back and can't profit. If I fail, it goes to whoever bet NO." |
| 4 | 1:15–1:45 | Phone: open the link → **Bet on this task** | Pick **NO**, enter an amount, show **Confirm your bet**, then confirm. Refresh the laptop so the NO total goes up | "A stranger on a phone with no wallet app bets against me. It works like a normal prediction market, and I can't bet NO on myself." |
| 5 | 1:45–2:10 | `/goals/10`, then `/goals/9` | A FAIL with reasons and two model votes, and **Check it yourself**. Then a PASS | "They promised a CSV parser with tests and pushed a table formatter. Two separate model checks both said no. The verdict is hashed on-chain, and this button re-checks it in your browser." |
| 6 | 2:10–2:35 | `/integrity` | 13 attacks caught, 0 got through | "We tried to cheat it ourselves: backdated commits, someone else's repo, filler commits, hidden prompt injections. It caught all 13." |
| 7 | 2:35–2:55 | `/goals/12` (market #9) | A resolved market: the owner failed and NO won | "This market has resolved. The owner failed and the NO bettors win, which they collect with one tap. The contract has no withdraw function, so we can't touch the money." |
| 8 | 2:55–3:00 | Home | Close | "Cash Cow: do it, or pay. It runs on Base Sepolia with AUSD." |

Steps 2–4 happen live. Steps 5–7 use rounds that are already judged, because a live round only gets judged at its deadline.

## Prep (10 minutes before)

- [ ] Open the site on both devices and check each shows a balance. On the phone, use a private tab so it gets a fresh wallet.
- [ ] Open these tabs on the laptop: `/`, `/goals/10`, `/goals/9`, `/goals/12`, `/integrity`.
- [ ] Have a public GitHub repo you own ready for the solo stake.
- [ ] **Check a solo round is open:** `/stake` should show the stake form. The current solo round stops taking stakes at **02:26 UTC**. After that, A opens a new one with the existing admin route; no code changes are needed:
      `curl -X POST <relayer>/admin/cohorts -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json" -d '{"rule_hash":"0x416252916541b8054ea5d4d1c6da5970a0b054e52232954e3f6c1cab76874c85","stake_minutes":60,"goal_minutes":30,"stake":"10"}'`
- [ ] Keep the laptop plugged in and awake, with the lid open.

## If something goes wrong

- **The page won't load:** the host laptop slept and the links changed. Get the new link from `shared/deployments.json`.
- **The balance shows 0:** press **Retry test AUSD faucet**.
- **A bet is slow:** the testnet RPC lags sometimes. Wait about 10 seconds and refresh. Don't bet twice.
- **Judge asks when a solo stake gets judged:** at the deadline. Stakes pay out automatically about 11 minutes later. Bet winners press **Claim my betting payout**.
