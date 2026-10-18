// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakePool} from "../src/StakePool.sol";
import {MarketPool} from "../src/MarketPool.sol";
import {CommitmentBond} from "../src/CommitmentBond.sol";
import {MockAUSD} from "./MockAUSD.sol";

/// Stands in for a smart wallet (e.g. a passkey account): a contract with no private key,
/// so it can never produce an ERC-3009 v/r/s signature. It can only make calls.
contract SmartWallet {
    function exec(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}

/// The direct stake/bet/bond paths: the caller approves, then calls. Works for any wallet.
contract DirectCallsTest is Test {
    MockAUSD token;
    StakePool pool;
    MarketPool market;
    CommitmentBond bond;
    address referee = makeAddr("referee");
    SmartWallet owner;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 cohort;
    uint64 close;
    uint64 deadline;
    uint256 constant STAKE = 10e6;
    bytes32 constant GOAL = keccak256("task");

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockAUSD();
        pool = new StakePool(address(token), referee);
        market = new MarketPool(address(pool));
        bond = new CommitmentBond(address(market));
        owner = new SmartWallet();
        close = uint64(block.timestamp + 1 hours);
        deadline = close + 1 hours;
        cohort = pool.createCohort(bytes32(0), close, deadline, STAKE);
        token.mint(address(owner), 1000e6);
        token.mint(alice, 1000e6);
        token.mint(bob, 1000e6);
    }

    function ownerCall(address target, bytes memory data) internal {
        owner.exec(target, data);
    }

    function ownerStake() internal {
        ownerCall(address(token), abi.encodeCall(token.approve, (address(pool), STAKE)));
        ownerCall(address(pool), abi.encodeCall(pool.stake, (cohort, GOAL)));
    }

    function directBet(address who, bool yes, uint256 amount) internal {
        vm.startPrank(who);
        token.approve(address(market), amount);
        market.bet(cohort, address(owner), yes, amount);
        vm.stopPrank();
    }

    function settle(bool passed) internal {
        vm.warp(deadline + 1);
        vm.prank(referee);
        pool.postVerdict(cohort, address(owner), passed, keccak256("evidence"));
        vm.warp(deadline + pool.SETTLE_DELAY());
        pool.settle(cohort);
        market.resolve(cohort, address(owner));
        (uint256 bonded,) = bond.bonds(bond.marketId(cohort, address(owner)));
        if (bonded != 0) bond.resolve(cohort, address(owner));
    }

    // ---- StakePool.stake ----

    function test_smartWalletStakesAndIsPaidBack() public {
        ownerStake();
        (bytes32 goalHash,,) = pool.stakes(cohort, address(owner));
        assertEq(goalHash, GOAL);
        assertEq(token.balanceOf(address(pool)), STAKE);
        assertEq(token.balanceOf(address(owner)), 1000e6 - STAKE);

        settle(true);
        pool.claimFor(cohort, address(owner));
        assertEq(token.balanceOf(address(owner)), 1000e6);
    }

    function test_stakeWithoutApprovalReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.stake(cohort, GOAL);
        (bytes32 goalHash,,) = pool.stakes(cohort, alice);
        assertEq(goalHash, bytes32(0), "failed stake leaves no record");
    }

    function test_stakeTakesExactlyStakeAmount() public {
        vm.startPrank(alice);
        token.approve(address(pool), 500e6);
        pool.stake(cohort, GOAL);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 1000e6 - STAKE);
        assertEq(token.allowance(alice, address(pool)), 500e6 - STAKE);
    }

    function test_stakeRulesMatchAuthorizationPath() public {
        ownerStake();
        ownerCall(address(token), abi.encodeCall(token.approve, (address(pool), STAKE)));
        vm.expectRevert(StakePool.AlreadyStaked.selector);
        ownerCall(address(pool), abi.encodeCall(pool.stake, (cohort, GOAL)));

        vm.startPrank(alice);
        token.approve(address(pool), STAKE);
        vm.expectRevert(StakePool.BadParams.selector);
        pool.stake(cohort, bytes32(0));
        vm.expectRevert(StakePool.UnknownCohort.selector);
        pool.stake(cohort + 1, GOAL);
        vm.warp(close + 1);
        vm.expectRevert(StakePool.StakingClosed.selector);
        pool.stake(cohort, GOAL);
        vm.stopPrank();
    }

    function test_stakeOnlyEverForCaller() public {
        // There is no way to name another staker: funds and the stake record are always msg.sender's.
        vm.startPrank(alice);
        token.approve(address(pool), STAKE);
        pool.stake(cohort, GOAL);
        vm.stopPrank();
        (bytes32 bobGoal,,) = pool.stakes(cohort, bob);
        assertEq(bobGoal, bytes32(0));
        assertEq(token.balanceOf(bob), 1000e6);
    }

    // ---- MarketPool.bet ----

    function test_directBetsPayWinners() public {
        ownerStake();
        directBet(alice, true, 30e6);
        directBet(bob, false, 20e6);
        assertEq(market.sequences(alice), 0, "direct bets do not use the ERC-3009 sequence");

        settle(true);
        market.claimFor(cohort, address(owner), alice);
        assertEq(token.balanceOf(alice), 1000e6 + 20e6);
        vm.expectRevert(MarketPool.NothingToClaim.selector);
        market.claimFor(cohort, address(owner), bob);
    }

    function test_directBetRulesMatchAuthorizationPath() public {
        vm.startPrank(alice);
        token.approve(address(market), 10e6);
        vm.expectRevert(MarketPool.NoCommitment.selector);
        market.bet(cohort, address(owner), true, 10e6);
        vm.stopPrank();

        ownerStake();
        ownerCall(address(token), abi.encodeCall(token.approve, (address(market), 10e6)));
        vm.expectRevert(MarketPool.OwnerCannotBet.selector);
        ownerCall(address(market), abi.encodeCall(market.bet, (cohort, address(owner), false, 10e6)));
        vm.expectRevert(MarketPool.OwnerCannotBet.selector);
        ownerCall(address(market), abi.encodeCall(market.bet, (cohort, address(owner), true, 10e6)));

        vm.startPrank(alice);
        vm.expectRevert(MarketPool.BadParams.selector);
        market.bet(cohort, address(owner), true, 0);
        vm.warp(close);
        vm.expectRevert(MarketPool.BettingClosed.selector);
        market.bet(cohort, address(owner), true, 10e6);
        vm.stopPrank();
    }

    // ---- CommitmentBond.bond ----

    function test_smartWalletBondGoesToNoBettorsOnFail() public {
        ownerStake();
        ownerCall(address(token), abi.encodeCall(token.approve, (address(bond), 50e6)));
        ownerCall(address(bond), abi.encodeCall(bond.bond, (cohort, 50e6)));
        (uint256 amount,) = bond.bonds(bond.marketId(cohort, address(owner)));
        assertEq(amount, 50e6);

        directBet(bob, false, 20e6);
        settle(false);
        uint256 before = token.balanceOf(bob);
        bond.claimFor(cohort, address(owner), bob);
        assertEq(token.balanceOf(bob) - before, 50e6);
    }

    function test_bondRulesMatchAuthorizationPath() public {
        vm.startPrank(alice);
        token.approve(address(bond), 50e6);
        vm.expectRevert(CommitmentBond.NoCommitment.selector);
        bond.bond(cohort, 50e6);
        vm.stopPrank();

        ownerStake();
        ownerCall(address(token), abi.encodeCall(token.approve, (address(bond), 100e6)));
        ownerCall(address(bond), abi.encodeCall(bond.bond, (cohort, 50e6)));
        vm.expectRevert(CommitmentBond.AlreadyBonded.selector);
        ownerCall(address(bond), abi.encodeCall(bond.bond, (cohort, 50e6)));
    }
}
