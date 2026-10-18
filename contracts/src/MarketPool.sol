// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StakePool, IERC20, IERC3009} from "./StakePool.sol";

/// @notice Separate, fee-free YES/NO pools for existing StakePool commitments.
/// Anyone may relay bets, resolve, or claim; payouts always go to the bettor.
contract MarketPool {
    enum Result {
        Pending,
        Yes,
        No,
        Refund
    }

    struct Market {
        uint256 yesTotal;
        uint256 noTotal;
        Result result;
    }

    struct Position {
        uint256 yesAmount;
        uint256 noAmount;
        bool claimed;
    }

    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    StakePool public immutable stakePool;
    address public immutable token;
    // Bounds the pro-rata multiplication below 2**256, even at maximal balances.
    uint256 public constant MAX_POOL = type(uint128).max;
    mapping(bytes32 => Market) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;
    mapping(address => uint256) public sequences;
    bool private entered;

    event Bet(
        bytes32 indexed marketId,
        uint256 indexed cohortId,
        address indexed owner,
        address bettor,
        bool yes,
        uint256 amount
    );
    event Resolved(bytes32 indexed marketId, Result result);
    event Claimed(bytes32 indexed marketId, address indexed bettor, uint256 amount);
    error BadParams();
    error NoCommitment();
    error BettingClosed();
    error OwnerCannotBet();
    error BadNonce();
    error NotSettled();
    error AlreadyResolved();
    error NothingToClaim();
    error TransferFailed();
    error Reentrant();

    modifier nonReentrant() {
        if (entered) revert Reentrant();
        entered = true;
        _;
        entered = false;
    }

    constructor(address stakePool_) {
        if (stakePool_ == address(0)) revert BadParams();
        stakePool = StakePool(stakePool_);
        token = stakePool.token();
    }

    function marketId(uint256 cohortId, address owner) public pure returns (bytes32) {
        return keccak256(abi.encode(cohortId, owner));
    }

    /// Binds each token authorization to the exact market, side, amount and bettor sequence.
    function authNonce(uint256 cohortId, address owner, address bettor, bool yes, uint256 amount, uint256 sequence)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(cohortId, owner, bettor, yes, amount, sequence));
    }

    function betWithAuthorization(
        uint256 cohortId,
        address owner,
        address bettor,
        bool yes,
        uint256 amount,
        Authorization calldata a
    ) external nonReentrant {
        bytes32 id = _checkBet(cohortId, owner, bettor, yes, amount);
        if (a.nonce != authNonce(cohortId, owner, bettor, yes, amount, sequences[bettor])) revert BadNonce();
        sequences[bettor]++;
        _applyBet(id, bettor, yes, amount);
        IERC3009(token)
            .receiveWithAuthorization(
                bettor, address(this), amount, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s
            );
        emit Bet(id, cohortId, owner, bettor, yes, amount);
    }

    /// Bet from the caller's own wallet: approve this pool for `amount` first. Works with any wallet.
    function bet(uint256 cohortId, address owner, bool yes, uint256 amount) external nonReentrant {
        bytes32 id = _checkBet(cohortId, owner, msg.sender, yes, amount);
        _applyBet(id, msg.sender, yes, amount);
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Bet(id, cohortId, owner, msg.sender, yes, amount);
    }

    function _checkBet(uint256 cohortId, address owner, address bettor, bool yes, uint256 amount)
        private
        view
        returns (bytes32 id)
    {
        {
            (bytes32 goalHash,,) = stakePool.stakes(cohortId, owner);
            if (goalHash == bytes32(0)) revert NoCommitment();
            (, uint64 deadline,,,,,, bool settled,) = stakePool.cohorts(cohortId);
            if (block.timestamp >= deadline || settled) revert BettingClosed();
        }
        id = marketId(cohortId, owner);
        Market storage m = markets[id];
        if (m.result != Result.Pending) revert BettingClosed();
        // The task's creator has their own stake in CommitmentBond; they may not bet on their own market at all.
        if (bettor == owner) revert OwnerCannotBet();
        if (bettor == address(0) || amount == 0 || amount > MAX_POOL - m.yesTotal - m.noTotal) revert BadParams();
    }

    function _applyBet(bytes32 id, address bettor, bool yes, uint256 amount) private {
        Market storage m = markets[id];
        Position storage p = positions[id][bettor];
        if (yes) {
            m.yesTotal += amount;
            p.yesAmount += amount;
        } else {
            m.noTotal += amount;
            p.noAmount += amount;
        }
    }

    /// A settled StakePool cannot accept late verdicts, so both pools always agree.
    function resolve(uint256 cohortId, address owner) external {
        (bytes32 goalHash, StakePool.Outcome outcome,) = stakePool.stakes(cohortId, owner);
        if (goalHash == bytes32(0)) revert NoCommitment();
        (,,,,,,, bool settled,) = stakePool.cohorts(cohortId);
        if (!settled) revert NotSettled();
        bytes32 id = marketId(cohortId, owner);
        Market storage m = markets[id];
        if (m.result != Result.Pending) revert AlreadyResolved();
        if (
            outcome == StakePool.Outcome.None || (outcome == StakePool.Outcome.Passed && m.yesTotal == 0)
                || (outcome == StakePool.Outcome.Failed && m.noTotal == 0)
        ) m.result = Result.Refund;
        else m.result = outcome == StakePool.Outcome.Passed ? Result.Yes : Result.No;
        emit Resolved(id, m.result);
    }

    function claimable(uint256 cohortId, address owner, address bettor) public view returns (uint256) {
        bytes32 id = marketId(cohortId, owner);
        Market storage m = markets[id];
        Position storage p = positions[id][bettor];
        if (p.claimed || m.result == Result.Pending) return 0;
        if (m.result == Result.Refund) return p.yesAmount + p.noAmount;
        uint256 winning = m.result == Result.Yes ? p.yesAmount : p.noAmount;
        uint256 totalWinning = m.result == Result.Yes ? m.yesTotal : m.noTotal;
        return winning * (m.yesTotal + m.noTotal) / totalWinning;
    }

    function claimFor(uint256 cohortId, address owner, address bettor) external nonReentrant {
        uint256 amount = claimable(cohortId, owner, bettor);
        if (amount == 0) revert NothingToClaim();
        bytes32 id = marketId(cohortId, owner);
        positions[id][bettor].claimed = true;
        if (!IERC20(token).transfer(bettor, amount)) revert TransferFailed();
        emit Claimed(id, bettor, amount);
    }
}
