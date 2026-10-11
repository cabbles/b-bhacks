// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakePool} from "../src/StakePool.sol";
import {MarketPool} from "../src/MarketPool.sol";
import {CommitmentBond} from "../src/CommitmentBond.sol";
import {MockAUSD} from "./MockAUSD.sol";

contract CommitmentBondTest is Test {
    MockAUSD token;
    StakePool stakePool;
    MarketPool market;
    CommitmentBond bond;
    address referee = makeAddr("referee");
    address owner;
    uint256 cohort;
    uint64 close;
    uint64 deadline;
    uint256 constant OWNER = 100;
    uint256 constant ALICE = 101;
    uint256 constant BOB = 102;
    uint256 constant CAROL = 103;
    uint256 constant BOND = 50e6;
    address constant BURN = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockAUSD();
        stakePool = new StakePool(address(token), referee);
        market = new MarketPool(address(stakePool));
        bond = new CommitmentBond(address(market));
        owner = vm.addr(OWNER);
        close = uint64(block.timestamp + 3600);
        deadline = close + 3600;
        cohort = stakePool.createCohort(bytes32(0), close, deadline, 1e6);
        for (uint256 k = OWNER; k <= CAROL; k++) {
            token.mint(vm.addr(k), 1000e6);
        }
        commit();
    }

    function sig(uint256 key, address to, uint256 amount, bytes32 nonce)
        internal
        view
        returns (MarketPool.Authorization memory a)
    {
        a.validBefore = type(uint256).max;
        a.nonce = nonce;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), vm.addr(key), to, amount, 0, a.validBefore, nonce))
            )
        );
        (a.v, a.r, a.s) = vm.sign(key, digest);
    }

    function commit() internal {
        bytes32 goal = keccak256("task");
        MarketPool.Authorization memory a = sig(OWNER, address(stakePool), 1e6, stakePool.authNonce(cohort, goal));
        stakePool.stakeWithAuthorization(cohort, owner, goal, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
    }

    function postBond(uint256 amount) internal {
        MarketPool.Authorization memory a = sig(OWNER, address(bond), amount, bond.bondNonce(cohort, owner, amount));
        bond.bondWithAuthorization(cohort, owner, amount, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
    }

    function bet(uint256 key, bool yes, uint256 amount) internal {
        address bettor = vm.addr(key);
        bytes32 nonce = market.authNonce(cohort, owner, bettor, yes, amount, market.sequences(bettor));
        market.betWithAuthorization(cohort, owner, bettor, yes, amount, sig(key, address(market), amount, nonce));
    }

    function settle(uint8 outcome) internal {
        vm.warp(deadline + 1);
        if (outcome != 0) {
            vm.prank(referee);
            stakePool.postVerdict(cohort, owner, outcome == 1, keccak256("evidence"));
        }
        vm.warp(deadline + 600);
        stakePool.settle(cohort);
        market.resolve(cohort, owner);
        bond.resolve(cohort, owner);
    }

    function test_passReturnsExactlyTheBond() public {
        postBond(BOND);
        bet(ALICE, true, 10e6);
        bet(BOB, false, 20e6);
        uint256 before = token.balanceOf(owner);
        settle(1);
        assertEq(token.balanceOf(owner) - before, BOND); // exactly X back, no share of bets
        assertEq(bond.claimable(cohort, owner, vm.addr(BOB)), 0);
        assertEq(token.balanceOf(address(bond)), 0);
    }

    function test_failPaysNoBettorsProRata() public {
        postBond(BOND);
        bet(ALICE, true, 10e6);
        bet(BOB, false, 20e6);
        bet(CAROL, false, 30e6);
        uint256 before = token.balanceOf(owner);
        settle(2);
        assertEq(token.balanceOf(owner), before); // owner gets nothing back
        assertEq(bond.claimable(cohort, owner, vm.addr(BOB)), 20e6); // 50 * 20/50
        assertEq(bond.claimable(cohort, owner, vm.addr(CAROL)), 30e6);
        assertEq(bond.claimable(cohort, owner, vm.addr(ALICE)), 0);
        vm.prank(makeAddr("anyone"));
        bond.claimFor(cohort, owner, vm.addr(BOB));
        bond.claimFor(cohort, owner, vm.addr(CAROL));
        assertEq(token.balanceOf(address(bond)), 0);
        vm.expectRevert(CommitmentBond.NothingToClaim.selector);
        bond.claimFor(cohort, owner, vm.addr(BOB));
    }

    function test_failWithNoNoBetsBurns() public {
        postBond(BOND);
        bet(ALICE, true, 10e6);
        settle(2);
        assertEq(token.balanceOf(BURN), BOND);
        assertEq(token.balanceOf(address(bond)), 0);
    }

    function test_noVerdictReturnsBond() public {
        postBond(BOND);
        uint256 before = token.balanceOf(owner);
        settle(0);
        assertEq(token.balanceOf(owner) - before, BOND);
    }

    function test_bondSeparateFromBetPool() public {
        postBond(BOND);
        bet(ALICE, true, 10e6);
        bet(BOB, false, 20e6);
        settle(2);
        // NO bettors win the bet pool from MarketPool (30) and the bond (50) from here, separately.
        assertEq(market.claimable(cohort, owner, vm.addr(BOB)), 30e6);
        assertEq(bond.claimable(cohort, owner, vm.addr(BOB)), 50e6);
    }

    function test_bondAfterBettingClosesReverts() public {
        vm.warp(close);
        MarketPool.Authorization memory a = sig(OWNER, address(bond), BOND, bond.bondNonce(cohort, owner, BOND));
        vm.expectRevert(CommitmentBond.BondingClosed.selector);
        bond.bondWithAuthorization(cohort, owner, BOND, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
    }

    function test_bondTwiceReverts() public {
        postBond(BOND);
        MarketPool.Authorization memory a = sig(OWNER, address(bond), 1e6, bond.bondNonce(cohort, owner, 1e6));
        vm.expectRevert(CommitmentBond.AlreadyBonded.selector);
        bond.bondWithAuthorization(cohort, owner, 1e6, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
    }

    function test_bondWithoutCommitmentReverts() public {
        address stranger = vm.addr(ALICE);
        MarketPool.Authorization memory a = sig(ALICE, address(bond), BOND, bond.bondNonce(cohort, stranger, BOND));
        vm.expectRevert(CommitmentBond.NoCommitment.selector);
        bond.bondWithAuthorization(cohort, stranger, BOND, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
    }

    function test_resolveBeforeSettleReverts() public {
        postBond(BOND);
        vm.expectRevert(CommitmentBond.NotSettled.selector);
        bond.resolve(cohort, owner);
    }
}
