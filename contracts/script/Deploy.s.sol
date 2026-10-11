// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StakePool} from "../src/StakePool.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $TREASURY_PRIVATE_KEY
/// Then: node scripts/export.mjs
contract Deploy is Script {
    // Testnet AUSD, same address on every Agora EVM testnet (docs.agora.finance/developer/contract-deployments).
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address constant REFEREE = 0x57CB6D4f98979403D89A6c2d6A7c17ef4D54eD3B;

    function run() external returns (StakePool pool) {
        address token = vm.envOr("AUSD_ADDRESS", AUSD_TESTNET);
        address referee = vm.envOr("REFEREE_ADDRESS", REFEREE);
        vm.startBroadcast();
        pool = new StakePool(token, referee);
        vm.stopBroadcast();
        console.log("StakePool", address(pool));
        console.log("token", token);
        console.log("referee", referee);
    }
}
