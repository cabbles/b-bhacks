// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StakePool} from "../src/StakePool.sol";
import {MarketPool} from "../src/MarketPool.sol";
import {CommitmentBond} from "../src/CommitmentBond.sol";

/// Deploys all three contracts, wired together. The deployer gets no special rights in any of them.
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --account <deployer>
/// STAKE_POOL=<address> keeps an existing StakePool (and its referee) and redeploys only MarketPool + CommitmentBond.
/// Then: node scripts/export.mjs
contract Deploy is Script {
    // Testnet AUSD, same address on every Agora EVM testnet (docs.agora.finance/developer/contract-deployments).
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address constant REFEREE = 0x57CB6D4f98979403D89A6c2d6A7c17ef4D54eD3B;

    function run() external returns (StakePool pool, MarketPool market, CommitmentBond bond) {
        address token = vm.envOr("AUSD_ADDRESS", AUSD_TESTNET);
        address referee = vm.envOr("REFEREE_ADDRESS", REFEREE);
        address existing = vm.envOr("STAKE_POOL", address(0));
        vm.startBroadcast();
        pool = existing != address(0) ? StakePool(existing) : new StakePool(token, referee);
        market = new MarketPool(address(pool));
        bond = new CommitmentBond(address(market));
        vm.stopBroadcast();
        console.log("StakePool", address(pool));
        console.log("MarketPool", address(market));
        console.log("CommitmentBond", address(bond));
        console.log("token", token);
        console.log("referee", pool.referee());
    }
}
