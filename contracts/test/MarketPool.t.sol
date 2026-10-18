// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {StakePool} from "../src/StakePool.sol";
import {MarketPool} from "../src/MarketPool.sol";
import {MockAUSD} from "./MockAUSD.sol";

contract MarketPoolTest is Test {
    MockAUSD token;
    StakePool stakePool;
    MarketPool market;
    address referee = makeAddr("referee");
    address owner;
    uint256 cohort;
    uint64 close;
    uint64 deadline;
    uint256 constant OWNER = 100;
    uint256 constant ALICE = 101;
    uint256 constant BOB = 102;
    uint256 constant CAROL = 103;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockAUSD();
        stakePool = new StakePool(address(token), referee);
        market = new MarketPool(address(stakePool));
        owner = vm.addr(OWNER);
        close = uint64(block.timestamp + 3600);
        deadline = close + 3600;
        cohort = stakePool.createCohort(bytes32(0), close, deadline, 10e6);
        for (uint256 k = OWNER; k <= CAROL; k++) {
            token.mint(vm.addr(k), 1000e6);
        }
        commit(OWNER);
    }

    function signature(uint256 key, address to, uint256 amount, bytes32 nonce)
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
                keccak256(
                    abi.encode(
                        token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), vm.addr(key), to, amount, 0, a.validBefore, nonce
                    )
                )
            )
        );
        (a.v, a.r, a.s) = vm.sign(key, digest);
    }

    function commit(uint256 key) internal {
        bytes32 goal = keccak256(abi.encode(key));
        MarketPool.Authorization memory a = signature(key, address(stakePool), 10e6, stakePool.authNonce(cohort, goal));
        stakePool.stakeWithAuthorization(
            cohort, vm.addr(key), goal, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s
        );
    }

    function auth(uint256 key, bool yes, uint256 amount) internal view returns (MarketPool.Authorization memory) {
        address bettor = vm.addr(key);
        uint256 sequence = market.sequences(bettor);
        bytes32 nonce = market.authNonce(cohort, owner, bettor, yes, amount, sequence);
        return signature(key, address(market), amount, nonce);
    }

    function bet(uint256 key, bool yes, uint256 amount) internal {
        market.betWithAuthorization(cohort, owner, vm.addr(key), yes, amount, auth(key, yes, amount));
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
    }

    function test_yesProRataAndSeparateCommitment() public {
        bet(ALICE, true, 10e6);
        bet(CAROL, true, 30e6);
        bet(BOB, false, 20e6);
        settle(1);
        assertEq(market.claimable(cohort, owner, vm.addr(ALICE)), 15e6);
        assertEq(market.claimable(cohort, owner, vm.addr(CAROL)), 45e6);
        assertEq(market.claimable(cohort, owner, vm.addr(BOB)), 0);
        vm.prank(makeAddr("any relayer"));
        market.claimFor(cohort, owner, vm.addr(ALICE));
        assertEq(token.balanceOf(vm.addr(ALICE)), 1005e6);
        market.claimFor(cohort, owner, vm.addr(CAROL));
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(token.balanceOf(address(stakePool)), 10e6);
    }

    function test_noWins() public {
        bet(ALICE, true, 10e6);
        bet(BOB, false, 20e6);
        settle(2);
        assertEq(market.claimable(cohort, owner, vm.addr(BOB)), 30e6);
        assertEq(market.claimable(cohort, owner, vm.addr(ALICE)), 0);
    }

    function test_missingVerdictRefundsBothSides() public {
        bet(ALICE, true, 10e6);
        bet(ALICE, false, 5e6);
        bet(BOB, false, 20e6);
        settle(0);
        assertEq(market.claimable(cohort, owner, vm.addr(ALICE)), 15e6);
        assertEq(market.claimable(cohort, owner, vm.addr(BOB)), 20e6);
    }

    function test_emptyWinningSideRefunds() public {
        bet(ALICE, true, 10e6);
        settle(2);
        assertEq(market.claimable(cohort, owner, vm.addr(ALICE)), 10e6);
    }

    function test_ownerCannotBetEitherSide() public {
        for (uint256 i = 0; i < 2; i++) {
            bool yes = i == 0;
            MarketPool.Authorization memory a = auth(OWNER, yes, 10e6);
            vm.expectRevert(MarketPool.OwnerCannotBet.selector);
            market.betWithAuthorization(cohort, owner, owner, yes, 10e6, a);
        }
    }

    function test_closeAtStakeDeadline() public {
        MarketPool.Authorization memory a = auth(ALICE, true, 10e6);
        vm.warp(close);
        vm.expectRevert(MarketPool.BettingClosed.selector);
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 10e6, a);
    }

    function test_noBetWithoutCommitment() public {
        MarketPool.Authorization memory a = auth(ALICE, true, 10e6);
        vm.expectRevert(MarketPool.NoCommitment.selector);
        market.betWithAuthorization(cohort, vm.addr(BOB), vm.addr(ALICE), true, 10e6, a);
    }

    function test_signatureBindsSideAmountAndOwner() public {
        MarketPool.Authorization memory a = auth(ALICE, true, 10e6);
        vm.expectRevert(MarketPool.BadNonce.selector);
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), false, 10e6, a);
        vm.expectRevert(MarketPool.BadNonce.selector);
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 11e6, a);
        commit(BOB);
        vm.expectRevert(MarketPool.BadNonce.selector);
        market.betWithAuthorization(cohort, vm.addr(BOB), vm.addr(ALICE), true, 10e6, a);
    }

    function test_replayFailsButFreshBetWorks() public {
        MarketPool.Authorization memory a = auth(ALICE, true, 10e6);
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 10e6, a);
        vm.expectRevert(MarketPool.BadNonce.selector);
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 10e6, a);
        bet(ALICE, true, 5e6);
        (uint256 yes,,) = market.positions(market.marketId(cohort, owner), vm.addr(ALICE));
        assertEq(yes, 15e6);
    }

    function test_forgedSignatureRollsBack() public {
        MarketPool.Authorization memory a =
            signature(BOB, address(market), 10e6, market.authNonce(cohort, owner, vm.addr(ALICE), true, 10e6, 0));
        vm.expectRevert(bytes("bad signature"));
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 10e6, a);
        assertEq(market.sequences(vm.addr(ALICE)), 0);
        assertEq(token.balanceOf(address(market)), 0);
    }

    function test_resolutionWaitsForFinalStakePoolOutcome() public {
        bet(ALICE, true, 10e6);
        bet(BOB, false, 10e6);
        vm.warp(deadline + 1000);
        vm.expectRevert(MarketPool.NotSettled.selector);
        market.resolve(cohort, owner);
        vm.prank(referee);
        stakePool.postVerdict(cohort, owner, false, bytes32(0));
        stakePool.settle(cohort);
        market.resolve(cohort, owner);
        (,, MarketPool.Result result) = market.markets(market.marketId(cohort, owner));
        assertEq(uint256(result), uint256(MarketPool.Result.No));
    }

    function test_doubleClaimAndResolveRevert() public {
        bet(ALICE, true, 10e6);
        vm.expectRevert(MarketPool.NothingToClaim.selector);
        market.claimFor(cohort, owner, vm.addr(ALICE));
        settle(1);
        market.claimFor(cohort, owner, vm.addr(ALICE));
        vm.expectRevert(MarketPool.NothingToClaim.selector);
        market.claimFor(cohort, owner, vm.addr(ALICE));
        vm.expectRevert(MarketPool.AlreadyResolved.selector);
        market.resolve(cohort, owner);
    }

    function test_zeroBetRejected() public {
        MarketPool.Authorization memory a = auth(ALICE, true, 0);
        vm.expectRevert(MarketPool.BadParams.selector);
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 0, a);
    }

    function test_signatureCannotMoveToAnotherCohortOrContract() public {
        MarketPool.Authorization memory a = auth(ALICE, true, 10e6);
        MarketPool other = new MarketPool(address(stakePool));
        vm.expectRevert(bytes("bad signature"));
        other.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 10e6, a);
        cohort = stakePool.createCohort(bytes32(0), close, deadline, 10e6);
        commit(OWNER);
        vm.expectRevert(MarketPool.BadNonce.selector);
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 10e6, a);
    }

    function test_expiredAuthorizationRollsBack() public {
        MarketPool.Authorization memory a = auth(ALICE, true, 10e6);
        a.validBefore = block.timestamp;
        vm.expectRevert(bytes("auth expired"));
        market.betWithAuthorization(cohort, owner, vm.addr(ALICE), true, 10e6, a);
        assertEq(market.sequences(vm.addr(ALICE)), 0);
    }

    function test_maxPoolBoundPreventsPayoutOverflow() public {
        uint256 cap = market.MAX_POOL();
        token.mint(vm.addr(ALICE), cap);
        bet(ALICE, true, cap - 1);
        bet(BOB, false, 1);
        MarketPool.Authorization memory a = auth(CAROL, true, 1);
        vm.expectRevert(MarketPool.BadParams.selector);
        market.betWithAuthorization(cohort, owner, vm.addr(CAROL), true, 1, a);
        settle(1);
        assertEq(market.claimable(cohort, owner, vm.addr(ALICE)), cap);
        market.claimFor(cohort, owner, vm.addr(ALICE));
        assertEq(token.balanceOf(address(market)), 0);
    }

    function test_refundClaimsReturnExactDeposits() public {
        bet(ALICE, true, 10e6);
        bet(ALICE, false, 5e6);
        bet(BOB, false, 20e6);
        settle(0);
        market.claimFor(cohort, owner, vm.addr(ALICE));
        market.claimFor(cohort, owner, vm.addr(BOB));
        assertEq(token.balanceOf(vm.addr(ALICE)), 1000e6);
        assertEq(token.balanceOf(vm.addr(BOB)), 1000e6);
        assertEq(token.balanceOf(address(market)), 0);
    }

    function testFuzz_conservation(uint64 yesA, uint64 yesC, uint64 noB, uint8 outcome) public {
        uint256 a = bound(yesA, 1, 1000e6);
        uint256 c = bound(yesC, 1, 1000e6);
        uint256 b = bound(noB, 1, 1000e6);
        bet(ALICE, true, a);
        bet(CAROL, true, c);
        bet(BOB, false, b);
        settle(outcome % 3);
        uint256 paid;
        for (uint256 k = ALICE; k <= CAROL; k++) {
            uint256 amount = market.claimable(cohort, owner, vm.addr(k));
            if (amount > 0) {
                market.claimFor(cohort, owner, vm.addr(k));
                paid += amount;
            }
        }
        assertLe(paid, a + b + c);
        assertLe(a + b + c - paid, 1);
        assertEq(token.balanceOf(address(market)), a + b + c - paid);
        assertEq(token.balanceOf(address(stakePool)), 10e6);
    }
}
