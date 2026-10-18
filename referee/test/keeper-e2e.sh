#!/usr/bin/env bash
# End-to-end test of the payout keeper (src/keeper.ts) on a local anvil chain. Needs Foundry (anvil, forge, cast).
#   bash referee/test/keeper-e2e.sh
# Deploys the contracts with a mock token, plays a round (owner stakes and bonds, two bettors, a FAIL verdict),
# then runs the keeper and checks every balance. The keys are anvil's well-known public test keys.
set -euo pipefail
S=$(mktemp -d); ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RPC=http://127.0.0.1:8547
pkill -f "anvil --port 8547" 2>/dev/null || true
anvil --port 8547 --chain-id 84532 --silent & ANVIL=$!; trap "kill $ANVIL; rm -rf $S" EXIT; sleep 1.5
K=(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba)
A=(); for k in "${K[@]}"; do A+=($(cast wallet address $k)); done
DEP=${A[0]}; REF=${A[1]}; OWNER=${A[2]}; ALICE=${A[3]}; BOB=${A[4]}
cd $ROOT/contracts
create() { forge create --rpc-url $RPC --private-key ${K[0]} --broadcast "$@" 2>/dev/null | awk '/Deployed to:/{print $3}'; }
TOKEN=$(create test/MockAUSD.sol:MockAUSD)
POOL=$(create src/StakePool.sol:StakePool --constructor-args $TOKEN $REF)
MARKET=$(create src/MarketPool.sol:MarketPool --constructor-args $POOL)
BOND=$(create src/CommitmentBond.sol:CommitmentBond --constructor-args $MARKET)
tx() { local k=$1; shift; cast send --rpc-url $RPC --private-key $k "$@" >/dev/null; }
for who in $OWNER $ALICE $BOB; do tx ${K[0]} $TOKEN "mint(address,uint256)" $who 1000000000; done
NOW=$(cast block latest -f timestamp --rpc-url $RPC)
tx ${K[0]} $POOL "createCohort(bytes32,uint64,uint64,uint256)" 0x$(printf '%064x' 1) $((NOW+300)) $((NOW+600)) 1000000
GOAL=0x$(printf '%064x' 42)
tx ${K[2]} $TOKEN "approve(address,uint256)" $POOL 1000000;   tx ${K[2]} $POOL "stake(uint256,bytes32)" 1 $GOAL
tx ${K[2]} $TOKEN "approve(address,uint256)" $BOND 50000000;  tx ${K[2]} $BOND "bond(uint256,uint256)" 1 50000000
tx ${K[3]} $TOKEN "approve(address,uint256)" $MARKET 30000000; tx ${K[3]} $MARKET "bet(uint256,address,bool,uint256)" 1 $OWNER true 30000000
tx ${K[4]} $TOKEN "approve(address,uint256)" $MARKET 20000000; tx ${K[4]} $MARKET "bet(uint256,address,bool,uint256)" 1 $OWNER false 20000000
cast rpc --rpc-url $RPC evm_increaseTime 601 >/dev/null; cast rpc --rpc-url $RPC evm_mine >/dev/null
tx ${K[1]} $POOL "postVerdict(uint256,address,bool,bytes32)" 1 $OWNER false 0x$(printf '%064x' 7)
cast rpc --rpc-url $RPC evm_increaseTime 700 >/dev/null; cast rpc --rpc-url $RPC evm_mine >/dev/null

rm -f $S/keeper-e2e*.db*
cd $ROOT/referee
run() { local db=$1; shift; env -i PATH="$PATH" HOME="$HOME" RPC_URL=$RPC POOL_ADDRESS=$POOL MARKET_POOL_ADDRESS=$MARKET BOND_ADDRESS=$BOND   KEEPER_PRIVATE_KEY=${K[5]} REFEREE_DB=$db MODEL_PROVIDER=off DOTENV_CONFIG_PATH=/dev/null "$@"   pnpm exec tsx -e "(async () => { const { setDb, ensureSchema } = await import('./src/db.ts'); const { sqliteDb } = await import('./src/db-sqlite.ts'); setDb(sqliteDb(process.env.REFEREE_DB)); await ensureSchema(); const { keeperTick } = await import('./src/keeper.ts'); for (let i = 0; i < 4; i++) await keeperTick(); })()"; }
bal() { cast call --rpc-url $RPC $TOKEN "balanceOf(address)(uint256)" $1 | awk '{print $1/1e6}'; }

echo "== 1. scan starting past the stakes (misconfigured DEPLOY_BLOCK): must not mark the round done"
run $S/keeper-e2e-bad.db DEPLOY_BLOCK=99999999 2>&1 | grep -v "^$" || true
sqlite3 $S/keeper-e2e-bad.db "select 'done rows (expect 0)', count(*) from keeper_done;"

echo "== 2. correct scan: everyone paid"
run $S/keeper-e2e.db 2>&1 | sed 's/ 0x[0-9a-f]*$//'
echo "owner=$(bal $OWNER) (expect 950)  alice=$(bal $ALICE) (expect 970)  bob=$(bal $BOB) (expect 1080)"
echo "pool=$(bal $POOL) market=$(bal $MARKET) bond=$(bal $BOND) (expect 0 0 0)"
sqlite3 $S/keeper-e2e.db "select 'done rows (expect 1)', count(*) from keeper_done; select 'stakers', count(*) from keeper_stakers; select 'bettors', count(*) from keeper_bettors;"
