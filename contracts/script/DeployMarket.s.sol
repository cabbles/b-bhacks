// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console} from "forge-std/Script.sol";
import {MarketPool} from "../src/MarketPool.sol";

contract DeployMarket is Script {
    function run() external returns (MarketPool pool) {
        address commitmentPool = vm.envAddress("POOL_ADDRESS");
        vm.startBroadcast();
        pool = new MarketPool(commitmentPool);
        vm.stopBroadcast();
        console.log("MarketPool", address(pool));
    }
}
