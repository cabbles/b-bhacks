// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakePool} from "../src/StakePool.sol";
import {MockAUSD} from "./MockAUSD.sol";

contract StakePoolTest is Test {
    MockAUSD token;
    StakePool pool;

    address referee = makeAddr("referee");
    address relayer = makeAddr("relayer");
    address owner = makeAddr("deployer");

    uint256 constant STAKE = 10e6;
    uint64 stakeDeadline;
    uint64 goalDeadline;
    uint256 cohort;

    uint256[] keys;
    address[] users;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockAUSD();
        vm.prank(owner);
        pool = new StakePool(address(token), referee);
        stakeDeadline = uint64(block.timestamp + 1 hours);
        goalDeadline = uint64(block.timestamp + 2 hours);
        cohort = pool.createCohort(keccak256("rules"), stakeDeadline, goalDeadline, STAKE);
        for (uint256 i = 0; i < 5; i++) {
            uint256 k = 0xA11CE + i;
            keys.push(k);
            users.push(vm.addr(k));
            token.mint(vm.addr(k), 100e6);
        }
    }

    // ---- helpers ----

    function goal(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode("goal", i));
    }

    function sign(uint256 key, uint256 value, bytes32 nonce) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(
                token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), vm.addr(key), address(pool), value, 0, type(uint256).max, nonce
            )
        );
        return vm.sign(key, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
    }

    function stake(uint256 i) internal {
        bytes32 nonce = pool.authNonce(cohort, goal(i));
        (uint8 v, bytes32 r, bytes32 s) = sign(keys[i], STAKE, nonce);
        vm.prank(relayer);
        pool.stakeWithAuthorization(cohort, users[i], goal(i), 0, type(uint256).max, nonce, v, r, s);
    }

    function verdict(uint256 i, bool passed) internal {
        vm.prank(referee);
        pool.postVerdict(cohort, users[i], passed, keccak256(abi.encode("evidence", i)));
    }

    function toSettle() internal {
        vm.warp(goalDeadline + pool.SETTLE_DELAY());
        pool.settle(cohort);
    }

    function claim(uint256 i) internal returns (uint256 got) {
        uint256 before = token.balanceOf(users[i]);
        vm.prank(makeAddr("anyone"));
        pool.claimFor(cohort, users[i]);
        got = token.balanceOf(users[i]) - before;
    }

    // ---- staking ----

    function test_stakePullsTokens() public {
        stake(0);
        assertEq(token.balanceOf(address(pool)), STAKE);
        assertEq(token.balanceOf(users[0]), 100e6 - STAKE);
        (bytes32 g,,) = pool.stakes(cohort, users[0]);
        assertEq(g, goal(0));
    }

    function test_stakeAfterDeadlineReverts() public {
        vm.warp(stakeDeadline + 1);
        bytes32 nonce = pool.authNonce(cohort, goal(0));
        (uint8 v, bytes32 r, bytes32 s) = sign(keys[0], STAKE, nonce);
        vm.expectRevert(StakePool.StakingClosed.selector);
        pool.stakeWithAuthorization(cohort, users[0], goal(0), 0, type(uint256).max, nonce, v, r, s);
    }

    function test_doubleStakeReverts() public {
        stake(0);
        // Fresh valid signature for a different goal in the same cohort.
        bytes32 nonce = pool.authNonce(cohort, goal(1));
        (uint8 v, bytes32 r, bytes32 s) = sign(keys[0], STAKE, nonce);
        vm.expectRevert(StakePool.AlreadyStaked.selector);
        pool.stakeWithAuthorization(cohort, users[0], goal(1), 0, type(uint256).max, nonce, v, r, s);
    }

    function test_replayedAuthorizationReverts() public {
        // Same signature reused for another cohort: nonce no longer matches that cohort.
        bytes32 nonce = pool.authNonce(cohort, goal(0));
        (uint8 v, bytes32 r, bytes32 s) = sign(keys[0], STAKE, nonce);
        pool.stakeWithAuthorization(cohort, users[0], goal(0), 0, type(uint256).max, nonce, v, r, s);
        uint256 other = pool.createCohort(keccak256("rules2"), stakeDeadline, goalDeadline, STAKE);
        vm.expectRevert(StakePool.BadNonce.selector);
        pool.stakeWithAuthorization(other, users[0], goal(0), 0, type(uint256).max, nonce, v, r, s);
    }

    function test_swappedGoalHashReverts() public {
        // A relayer cannot attach a different goal to the user's signature.
        bytes32 nonce = pool.authNonce(cohort, goal(0));
        (uint8 v, bytes32 r, bytes32 s) = sign(keys[0], STAKE, nonce);
        vm.expectRevert(StakePool.BadNonce.selector);
        pool.stakeWithAuthorization(cohort, users[0], goal(9), 0, type(uint256).max, nonce, v, r, s);
    }

    function test_forgedSignatureReverts() public {
        bytes32 nonce = pool.authNonce(cohort, goal(0));
        (uint8 v, bytes32 r, bytes32 s) = sign(keys[1], STAKE, nonce); // signed by someone else
        vm.expectRevert(bytes("bad signature"));
        pool.stakeWithAuthorization(cohort, users[0], goal(0), 0, type(uint256).max, nonce, v, r, s);
    }

    // ---- verdicts ----

    function test_nonRefereeCannotPostVerdict() public {
        stake(0);
        vm.warp(goalDeadline + 1);
        vm.expectRevert(StakePool.NotReferee.selector);
        vm.prank(owner);
        pool.postVerdict(cohort, users[0], true, bytes32(0));
        vm.expectRevert(StakePool.NotReferee.selector);
        vm.prank(relayer);
        pool.postVerdict(cohort, users[0], true, bytes32(0));
    }

    function test_verdictBeforeDeadlineReverts() public {
        stake(0);
        vm.warp(goalDeadline);
        vm.expectRevert(StakePool.TooEarly.selector);
        verdict(0, true);
    }

    function test_oneVerdictPerStaker() public {
        stake(0);
        vm.warp(goalDeadline + 1);
        verdict(0, false);
        vm.expectRevert(StakePool.AlreadyDecided.selector);
        verdict(0, true);
    }

    function test_verdictForNonStakerReverts() public {
        vm.warp(goalDeadline + 1);
        vm.expectRevert(StakePool.NotStaked.selector);
        verdict(0, true);
    }

    function test_verdictAfterSettleReverts() public {
        stake(0);
        toSettle();
        vm.expectRevert(StakePool.AlreadySettled.selector);
        verdict(0, true);
    }

    // ---- settlement rules ----

    function test_passersSplitForfeits() public {
        for (uint256 i = 0; i < 4; i++) stake(i);
        vm.warp(goalDeadline + 1);
        verdict(0, true);
        verdict(1, true);
        verdict(2, false);
        verdict(3, false);
        toSettle();
        assertEq(claim(0), STAKE + STAKE); // stake + (2 forfeits / 2 passers)
        assertEq(claim(1), STAKE + STAKE);
        vm.expectRevert(StakePool.NothingToClaim.selector);
        pool.claimFor(cohort, users[2]);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_missingVerdictIsRefunded() public {
        for (uint256 i = 0; i < 3; i++) stake(i);
        vm.warp(goalDeadline + 1);
        verdict(0, true);
        verdict(1, false);
        // users[2]: referee never posted
        toSettle();
        assertEq(claim(2), STAKE);
        assertEq(claim(0), STAKE + STAKE);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_refereeOutageRefundsEveryone() public {
        for (uint256 i = 0; i < 3; i++) stake(i);
        toSettle();
        for (uint256 i = 0; i < 3; i++) assertEq(claim(i), STAKE);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_nobodyPassedEveryoneRefunded() public {
        for (uint256 i = 0; i < 3; i++) stake(i);
        vm.warp(goalDeadline + 1);
        for (uint256 i = 0; i < 3; i++) verdict(i, false);
        toSettle();
        for (uint256 i = 0; i < 3; i++) assertEq(claim(i), STAKE);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_unevenSplitLeavesOnlyDust() public {
        for (uint256 i = 0; i < 5; i++) stake(i);
        vm.warp(goalDeadline + 1);
        verdict(0, true);
        verdict(1, true);
        verdict(2, true);
        verdict(3, false);
        verdict(4, false);
        toSettle();
        uint256 share = (2 * STAKE) / 3;
        for (uint256 i = 0; i < 3; i++) assertEq(claim(i), STAKE + share);
        assertLt(token.balanceOf(address(pool)), 3); // < passCount wei of rounding dust
    }

    function test_settleTooEarlyReverts() public {
        stake(0);
        vm.warp(goalDeadline + pool.SETTLE_DELAY() - 1);
        vm.expectRevert(StakePool.TooEarly.selector);
        pool.settle(cohort);
    }

    function test_doubleSettleReverts() public {
        toSettle();
        vm.expectRevert(StakePool.AlreadySettled.selector);
        pool.settle(cohort);
    }

    function test_claimBeforeSettleReverts() public {
        stake(0);
        vm.expectRevert(StakePool.NotSettled.selector);
        pool.claimFor(cohort, users[0]);
    }

    function test_doubleClaimReverts() public {
        stake(0);
        toSettle();
        claim(0);
        vm.expectRevert(StakePool.AlreadyClaimed.selector);
        pool.claimFor(cohort, users[0]);
    }

    function test_claimAlwaysPaysStaker() public {
        stake(0);
        toSettle();
        address caller = makeAddr("caller");
        vm.prank(caller);
        pool.claimFor(cohort, users[0]);
        assertEq(token.balanceOf(caller), 0);
        assertEq(token.balanceOf(users[0]), 100e6);
    }

    /// Nobody but stakers can ever receive funds: no owner, referee, or relayer gets anything.
    function testFuzz_conservation(uint16 outcomes) public {
        for (uint256 i = 0; i < 5; i++) stake(i);
        vm.warp(goalDeadline + 1);
        for (uint256 i = 0; i < 5; i++) {
            uint256 o = ((outcomes >> (i * 2)) & 3) % 3; // 0 none, 1 pass, 2 fail
            if (o == 1) verdict(i, true);
            else if (o == 2) verdict(i, false);
        }
        toSettle();
        uint256 paid;
        for (uint256 i = 0; i < 5; i++) {
            uint256 c = pool.claimable(cohort, users[i]);
            if (c > 0) paid += claim(i);
        }
        assertLe(paid, 5 * STAKE);
        assertLt(5 * STAKE - paid, 5); // only rounding dust remains
        assertEq(token.balanceOf(owner), 0);
        assertEq(token.balanceOf(referee), 0);
        assertEq(token.balanceOf(relayer), 0);
    }
}
