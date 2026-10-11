# CP2: end-to-end test run

Checkpoint 2 from PLAN.md section 7: one real `github_commits` goal goes stake → watch → verdict on-chain → settle → claim, on Base Sepolia, through the real web UI.

## Setup

- Pool: `0x1470af4526f820DC7Ca5bE70cA77bBf2400e76f9` (Base Sepolia, chain 84532)
- Token: AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, EIP-712 domain "Agora Dollar" v1
- Cohort 1: stake 10 AUSD, staking closes 21:38Z, goal deadline 21:48Z
- Staker: the web app's in-browser wallet `0xDed47086d42c39cD7090DAaF1c0bF7F9EFd0EC5f`

## Steps observed

1. **Join.** Opened the web app; the relayer's `/drip` sent 100 AUSD to the browser wallet.
2. **Compile.** Typed the goal; the referee compiled it into `github_commits` criteria for `cabbles/b-bhacks` branch `cp2-proof`, `min_commits: 2`, nonce `ref-9b8040b6`, deadline 21:48Z. The web recomputed `goal_hash` with `shared/canonical.ts` before signing.
3. **Stake.** Signed ERC-3009 `ReceiveWithAuthorization` with nonce `authNonce(1, goalHash)`; the relayer submitted `stakeWithAuthorization`. Stake tx `0x46595f…55777f`. Registered with the referee as goal 1. The goal page's "Check it yourself" panel confirmed the pool's recorded goalHash `0xdcea45fc…3f64456` matches the criteria.
4. **Watch.** Pushed the nonce file and these two commits to `cp2-proof` after staking, so the referee first sees them inside the window.

Verdict, settle, and claim results are added to this file after the deadline.
