// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {StakePool} from "../src/StakePool.sol";
import {MarketPool} from "../src/MarketPool.sol";

interface IForkAUSD {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// Runs entirely on a local fork. No real testnet transactions or credentials.
contract MarketPoolForkTest is Test {
    address constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address constant FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;
    bytes32 constant RECEIVE = keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
    function sign(uint256 key, address to, uint256 amount, bytes32 nonce) internal view returns (MarketPool.Authorization memory a) {
        a.nonce = nonce; a.validBefore = type(uint256).max;
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IForkAUSD(AUSD).DOMAIN_SEPARATOR(),
            keccak256(abi.encode(RECEIVE, vm.addr(key), to, amount, 0, a.validBefore, nonce))));
        (a.v, a.r, a.s) = vm.sign(key, digest);
    }
    function test_realAusdBetResolveClaim() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc);
        address referee = makeAddr("referee");
        StakePool pool = new StakePool(AUSD, referee);
        MarketPool market = new MarketPool(address(pool));
        uint64 end = uint64(block.timestamp + 1200);
        uint256 cohort = pool.createCohort(bytes32(0), end - 600, end, 10e6);
        address owner = vm.addr(100);
        address yesBettor = vm.addr(101);
        address noBettor = vm.addr(102);
        for (uint256 k = 100; k <= 102; k++) { vm.prank(FAUCET); IForkAUSD(AUSD).transfer(vm.addr(k), 100e6); }
        bytes32 goal = keccak256("test goal");
        MarketPool.Authorization memory a = sign(100, address(pool), 10e6, pool.authNonce(cohort, goal));
        pool.stakeWithAuthorization(cohort, owner, goal, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
        a = sign(101, address(market), 10e6, market.authNonce(cohort, owner, yesBettor, true, 10e6, 0));
        market.betWithAuthorization(cohort, owner, yesBettor, true, 10e6, a);
        a = sign(102, address(market), 20e6, market.authNonce(cohort, owner, noBettor, false, 20e6, 0));
        market.betWithAuthorization(cohort, owner, noBettor, false, 20e6, a);
        vm.warp(end + 1); vm.prank(referee); pool.postVerdict(cohort, owner, true, keccak256("proof"));
        vm.warp(end + 600); pool.settle(cohort); market.resolve(cohort, owner);
        market.claimFor(cohort, owner, yesBettor);
        assertEq(IForkAUSD(AUSD).balanceOf(yesBettor), 120e6);
        assertEq(IForkAUSD(AUSD).balanceOf(noBettor), 80e6);
        assertEq(IForkAUSD(AUSD).balanceOf(address(pool)), 10e6);
        assertEq(IForkAUSD(AUSD).balanceOf(address(market)), 0);
    }
}
