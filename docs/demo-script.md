# Demo script (2 minutes)

The video opens with the backdated commit being rejected. Keep each beat short. Total ≈ 120 s.

## Shot list

| # | Time | Screen | Say / show |
|---|------|--------|------------|
| 1 | 0:00–0:15 | Verdict page for a backdated-commit goal (`/goals/:id`) showing **FAIL** and the `commits_in_window` check | "This person backdated three commits to last week. The referee doesn't believe timestamps; it only counts what it saw itself. Rejected." |
| 2 | 0:15–0:25 | Join screen on a phone (`/`) | "Scan, and you have a wallet and 100 test AUSD. No install, no seed phrase. Testnet only." |
| 3 | 0:25–0:45 | Stake screen: type a goal → summary → nonce file instruction → Stake | "Type a goal in plain words. The referee turns it into exact criteria and gives you a nonce file to prove the repo is yours. You sign once, and the relayer pays gas." |
| 4 | 0:45–1:00 | Cohort board on the projector (`/cohorts/1`) | "Here's the room's live cohort: stakers, pot, countdown, QR code." |
| 5 | 1:00–1:20 | Fool the Ref board (`/fool`) | "Anyone can try to cheat: prompt injection in a README, filler commits, a fake static page. Every attempt is public, including the ones that worked." Point at the fooled count honestly. |
| 6 | 1:20–1:40 | A passing verdict page: checks, two model votes, verdict tx link → Basescan | "Every verdict is on-chain with a hash of the full reasoning. Two models must agree on substance, or a human decides, and overrides are counted." |
| 7 | 1:40–1:55 | Claim tx on Basescan / balance going up | "After the deadline, passers split the forfeits. The contract has no withdraw function, so the referee can't profit. No verdict means a refund." |
| 8 | 1:55–2:00 | README results table | Real stakers, attack attempts, human overrides. |

## Prep checklist

- [ ] A backdated-commit goal already judged (red team harness or a manual one).
- [ ] One passing `github_commits` goal and one passing `url_live` goal with verdict txs.
- [ ] Cohort board open on the projector at `/cohorts/<id>`.
- [ ] Phone with a fresh browser profile for the join shot.
- [ ] Screenshots saved to `docs/screenshots/` (join, stake, verdict pass, verdict fail, board, fool).
- [ ] README numbers filled in from the live cohort and `redteam/results.md`.
