# YES/NO betting

Implemented in `contracts/src/MarketPool.sol`, `relayer/src/markets.ts`, and the goal page's `PredictionMarket` component. Deployment is recorded separately in `contracts/deployments/market-pool.json`; a null address means the feature is not yet live. Existing shared interfaces and StakePool deployment are unchanged.

## Rules

- Each existing `(cohortId, task owner)` commitment has a deterministic betting market. The first bet opens its pot; no separate creation transaction is needed.
- Anyone can bet YES or NO with test AUSD. The task owner's address cannot bet NO. This address check does not establish real-world identity or prevent a person from using another wallet.
- Bets close at the cohort's **stake deadline**, including the exact deadline timestamp. This avoids accepting bets after the task's outcome becomes final. Funds cannot be cancelled or withdrawn while betting is open.
- Each ERC-3009 `ReceiveWithAuthorization` names MarketPool as recipient. Its nonce binds the cohort, task owner, bettor, side, amount and the bettor's next sequence. The relayer cannot change these fields or replay a bet. Fresh signatures allow additional bets.
- Resolution reads `StakePool.stakes(cohortId, owner).outcome` and requires the cohort to be **settled** first. There is no second AI ruling and no ability to change the result. Settlement itself follows the existing StakePool lifecycle.
- YES wins on pass; NO wins on fail. Winners divide the whole betting pot in proportion to their winning deposits. A missing verdict or no deposits on the winning side refunds every bettor's deposits.
- Anyone may resolve or submit a claim. Claims always pay the recorded bettor, once. Commitment stakes remain in StakePool. There is no owner, withdrawal function, or fee.
- Integer division rounds each payout down; less than one smallest token unit per winning wallet may remain locked. Aggregate deposits per market are capped at `uint128.max` raw units to keep payout multiplication safe.

## Deploy on Base Sepolia

On the machine that already runs the funded relayer:

1. Pull the implementation and install the locked workspace dependencies.
2. Build and test: `cd contracts && forge test --use 0.8.24`, then return to the repository root.
3. Export the ABI: `node contracts/scripts/export-market.mjs`.
4. Keep the existing `RPC_URL` and `TREASURY_PRIVATE_KEY` in the relayer's ignored environment file. Do not put the key in a command argument or commit it.
5. Run `pnpm --filter relayer deploy:market`. This deploys against the existing StakePool and records the contract address, transaction and block in `contracts/deployments/market-pool.json`. It refuses a non-Base-Sepolia RPC or an already recorded deployment.
6. Commit the public deployment metadata. Restart the relayer and rebuild/restart the web. `GET /config` must now include a non-null `market_pool` address. The relayer checks the configured MarketPool links to its StakePool before enabling it.
7. Stake a fresh task before the joining deadline, open its goal page from another browser, place YES and NO bets, then resolve and claim after commitment settlement. Betting controls remain hidden against old relayers, fixture mode, or an undeployed pool.

The alternate Foundry deployment script is `contracts/script/DeployMarket.s.sol`; set `POOL_ADDRESS` to the existing StakePool and use a configured Foundry signer. Run `export-market.mjs` afterwards to import its successful Base Sepolia broadcast.

`MARKET_POOL_ADDRESS` can override the metadata on the relayer. `TOKEN_ADDRESS` and `POOL_ADDRESS` overrides support isolated local tests; do not point a public relayer at mismatched contracts.

## API

- `GET /markets/:cohort/:owner?bettor=0x…`: pool totals, settlement/result, deadlines, bettor positions, next sequence and claimable amount, read at one block.
- `POST /markets/bet`: `{ cohort_id, owner, bettor, yes, amount, authorization }`; `amount` is a decimal string in raw token units, `yes` is a boolean, and authorization uses the existing web ERC-3009 shape.
- `POST /markets/resolve`: `{ cohort_id, owner }`.
- `POST /markets/claim`: `{ cohort_id, owner, bettor }`.

Writes return `{ tx_hash }` after successful confirmation. Failed authorization, closed betting, invalid arguments and premature settlement return readable errors. Market routes return 503 when no contract is configured. Writes are rate-limited per network.

## Validation

- Foundry tests cover YES and NO payouts, split winners, both-sided positions, refunds, owner NO rejection, exact closing time, missing commitments, replay/forgery/expiry, cross-market and cross-contract signatures, double claims, waiting for final settlement, pool arithmetic bounds, and fuzzed token conservation.
- `pnpm --filter relayer test:markets` launches a disposable Anvil chain, deploys the real contracts, starts the full relayer, signs using the web's actual signing functions, and checks bets, rejected attacks, settlement, resolution and payout. Requires `anvil` on PATH (or `ANVIL_BIN`) and built Foundry artifacts. Its SQLite file, wallets and chain are temporary; no live credentials are used. Run with the Node version used to install `better-sqlite3`.
- Local browser QA can keep these services running with `MARKET_QA_CONFIG=/tmp/market-qa.json`; the file contains only local endpoints and public contract addresses. This also provides a local read-only goal fixture for checking the real betting UI.

A Base Sepolia deployment and public-host restart still require the team's configured deployer/host. Local tests do not claim that the public site has activated betting.
