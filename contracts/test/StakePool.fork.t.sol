// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakePool} from "../src/StakePool.sol";
import {MarketPool} from "../src/MarketPool.sol";
import {SmartWallet} from "./DirectCalls.t.sol";

interface IAUSD {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function approve(address, uint256) external returns (bool);
}

/// Runs only with FORK_RPC_URL set: proves the real Base Sepolia AUSD accepts the pool's
/// receiveWithAuthorization flow end to end.
///   FORK_RPC_URL=https://sepolia.base.org forge test --match-contract Fork
contract StakePoolForkTest is Test {
    address constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address constant FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function test_realAusdStakeAndClaim() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        address referee = makeAddr("referee");
        StakePool pool = new StakePool(AUSD, referee);
        uint256 stakeAmt = 10e6;
        uint64 sd = uint64(block.timestamp + 600);
        uint64 gd = uint64(block.timestamp + 1200);
        uint256 cohort = pool.createCohort(bytes32(0), sd, gd, stakeAmt);

        uint256 key = 0xB0B;
        address user = vm.addr(key);
        vm.prank(FAUCET);
        IAUSD(AUSD).transfer(user, 100e6);

        bytes32 goalHash = keccak256("goal");
        bytes32 nonce = pool.authNonce(cohort, goalHash);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IAUSD(AUSD).DOMAIN_SEPARATOR(),
                keccak256(abi.encode(RECEIVE_TYPEHASH, user, address(pool), stakeAmt, 0, type(uint256).max, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        pool.stakeWithAuthorization(cohort, user, goalHash, 0, type(uint256).max, nonce, v, r, s);
        assertEq(IAUSD(AUSD).balanceOf(address(pool)), stakeAmt);

        vm.warp(gd + 1);
        vm.prank(referee);
        pool.postVerdict(cohort, user, true, bytes32(uint256(1)));
        vm.warp(gd + pool.SETTLE_DELAY());
        pool.settle(cohort);
        pool.claimFor(cohort, user);
        assertEq(IAUSD(AUSD).balanceOf(user), 100e6);
    }

    /// The direct path on real AUSD: a contract wallet (no private key) approves, stakes, is bet on, and is paid.
    function test_realAusdDirectStakeAndBetFromContractWallet() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        address referee = makeAddr("referee");
        StakePool pool = new StakePool(AUSD, referee);
        MarketPool market = new MarketPool(address(pool));
        uint64 sd = uint64(block.timestamp + 600);
        uint64 gd = uint64(block.timestamp + 1200);
        uint256 cohort = pool.createCohort(bytes32(0), sd, gd, 10e6);

        SmartWallet wallet = new SmartWallet();
        address bettor = makeAddr("bettor");
        vm.startPrank(FAUCET);
        IAUSD(AUSD).transfer(address(wallet), 100e6);
        IAUSD(AUSD).transfer(bettor, 100e6);
        vm.stopPrank();

        wallet.exec(AUSD, abi.encodeCall(IAUSD.approve, (address(pool), 10e6)));
        wallet.exec(address(pool), abi.encodeCall(pool.stake, (cohort, keccak256("goal"))));
        assertEq(IAUSD(AUSD).balanceOf(address(pool)), 10e6);

        vm.startPrank(bettor);
        IAUSD(AUSD).approve(address(market), 5e6);
        market.bet(cohort, address(wallet), false, 5e6);
        vm.stopPrank();

        vm.warp(gd + 1);
        vm.prank(referee);
        pool.postVerdict(cohort, address(wallet), true, bytes32(uint256(1)));
        vm.warp(gd + pool.SETTLE_DELAY());
        pool.settle(cohort);
        pool.claimFor(cohort, address(wallet));
        market.resolve(cohort, address(wallet));
        assertEq(IAUSD(AUSD).balanceOf(address(wallet)), 100e6);
    }
}
