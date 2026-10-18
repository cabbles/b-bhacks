# Live demo (2 minutes)

**One message:** put your own money on your task, and let anyone bet on whether you'll do it.

Laptop = task owner, phone (private tab) = bettor. Use the public site on both devices (the phone can't reach localhost): https://lion-browsing-princess-legends.trycloudflare.com, or whatever `shared/deployments.json` lists as `web_url`.

| # | Time | Screen | Do | Say |
|---|------|--------|----|-----|
| 1 | 0:00–0:15 | Home `/` | Nothing | "Everyone says they'll finish it this weekend. Cash Cow makes you put money on it, and lets everyone else bet on whether you will." |
| 2 | 0:15–0:45 | `/cohorts/new` | Type a task ("Ship the settings page by Sunday"), set a stake, create, **Copy link** | "I make a public market on my own task, backed by my own stake. That stake is separate from the betting. If I finish, I get it back. If I don't, I lose it to the people who bet against me." |
| 3 | 0:45–1:15 | Phone: open link, **Bet on this task** | Pick **NO**, enter an amount, confirm. Refresh the laptop so the NO total moves | "My friend thinks I'll flake, so they bet NO. No wallet app and no gas: the site gives them a wallet and test dollars. It's a normal prediction market, and anyone can bet either side." |
| 4 | 1:15–1:40 | `/goals/12` (market #9, resolved) | Scroll to the result and the payout | "Here's one that resolved. The owner missed the deadline, so NO won, and the owner's stake goes to the NO bettors. They claim it with one tap. The contract has no withdraw function, so we can't touch the money." |
| 5 | 1:40–1:52 | `/goals/9` (pass) | Point at the verdict briefly | "Whether you did it is checked against the evidence, like your commits, and the result is recorded on-chain." |
| 6 | 1:52–2:00 | Home | Nothing | "Cash Cow: do it, or pay. Running on Base Sepolia." |

Steps 2–3 are live. Steps 4–5 use rounds that are already settled, because a live market only resolves at its deadline.

## Prep

- [ ] Referee (`localhost:8787/health`) and relayer (`/health` on the URL in `shared/deployments.json`) both answer.
- [ ] Phone: open the site in a private tab and check the balance shows. If it shows 0, press **Retry test AUSD faucet**.
- [ ] Laptop tabs: `/`, `/cohorts/new`, `/goals/12`, `/goals/9`.
- [ ] Laptop plugged in and awake.

## If something goes wrong

- **A bet is slow:** the testnet lags. Wait about 10 seconds and refresh. Don't bet twice.
- **"How do you know they did it?"** "We check the evidence after the deadline: commits, a live page, or a Canvas submission. No verdict means everyone gets refunded."
