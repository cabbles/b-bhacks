// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
}

interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title StakePool
/// @notice People stake a token on finishing a goal. An immutable referee posts pass/fail.
///         Passers get their stake back plus an equal share of forfeited stakes.
///         There is no owner and no function that sends funds anywhere except back to stakers.
contract StakePool {
    enum Outcome {
        None,
        Passed,
        Failed
    }

    struct Cohort {
        bytes32 ruleHash;
        uint64 stakeDeadline;
        uint64 goalDeadline;
        uint256 stakeAmount;
        uint32 stakerCount;
        uint32 passCount;
        uint32 failCount;
        bool settled;
        uint256 forfeitPool;
    }

    struct Stake {
        bytes32 goalHash;
        Outcome outcome;
        bool claimed;
    }

    uint64 public constant SETTLE_DELAY = 10 minutes;

    address public immutable token;
    address public immutable referee;

    uint256 public cohortCount;
    mapping(uint256 => Cohort) public cohorts;
    mapping(uint256 => mapping(address => Stake)) public stakes;

    event CohortCreated(
        uint256 indexed cohortId, bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount
    );
    event Staked(uint256 indexed cohortId, address indexed staker, bytes32 goalHash);
    event Verdict(uint256 indexed cohortId, address indexed staker, bool passed, bytes32 evidenceHash);
    event Settled(uint256 indexed cohortId, uint256 passCount, uint256 forfeitPool);
    event Claimed(uint256 indexed cohortId, address indexed staker, uint256 amount);

    error BadParams();
    error UnknownCohort();
    error StakingClosed();
    error AlreadyStaked();
    error BadNonce();
    error NotReferee();
    error NotStaked();
    error TooEarly();
    error AlreadyDecided();
    error AlreadySettled();
    error NotSettled();
    error AlreadyClaimed();
    error NothingToClaim();
    error TransferFailed();

    constructor(address token_, address referee_) {
        if (token_ == address(0) || referee_ == address(0)) revert BadParams();
        token = token_;
        referee = referee_;
    }

    /// @notice The ERC-3009 nonce a staker must sign. Binds the signature to one cohort and one goal,
    ///         so a relayed authorization cannot be redirected to another cohort or goal.
    function authNonce(uint256 cohortId, bytes32 goalHash) public pure returns (bytes32) {
        return keccak256(abi.encode(cohortId, goalHash));
    }

    function createCohort(bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount)
        external
        returns (uint256 cohortId)
    {
        if (stakeAmount == 0 || stakeDeadline <= block.timestamp || goalDeadline < stakeDeadline) revert BadParams();
        cohortId = ++cohortCount;
        Cohort storage c = cohorts[cohortId];
        c.ruleHash = ruleHash;
        c.stakeDeadline = stakeDeadline;
        c.goalDeadline = goalDeadline;
        c.stakeAmount = stakeAmount;
        emit CohortCreated(cohortId, ruleHash, stakeDeadline, goalDeadline, stakeAmount);
    }

    /// @notice Pulls stakeAmount from staker with an ERC-3009 receiveWithAuthorization (to = this pool).
    ///         Anyone may submit it (normally the relayer); the signature fixes staker, amount, cohort and goal.
    function stakeWithAuthorization(
        uint256 cohortId,
        address staker,
        bytes32 goalHash,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        Cohort storage c = cohorts[cohortId];
        if (c.stakeAmount == 0) revert UnknownCohort();
        if (block.timestamp > c.stakeDeadline) revert StakingClosed();
        if (goalHash == bytes32(0) || staker == address(0)) revert BadParams();
        if (nonce != authNonce(cohortId, goalHash)) revert BadNonce();
        Stake storage st = stakes[cohortId][staker];
        if (st.goalHash != bytes32(0)) revert AlreadyStaked();

        st.goalHash = goalHash;
        c.stakerCount += 1;

        IERC3009(token).receiveWithAuthorization(
            staker, address(this), c.stakeAmount, validAfter, validBefore, nonce, v, r, s
        );
        emit Staked(cohortId, staker, goalHash);
    }

    /// @notice One verdict per (cohort, staker), only by the referee, only after the goal deadline
    ///         and before the cohort is settled. A verdict that never arrives means a refund.
    function postVerdict(uint256 cohortId, address staker, bool passed, bytes32 evidenceHash) external {
        if (msg.sender != referee) revert NotReferee();
        Cohort storage c = cohorts[cohortId];
        if (c.stakeAmount == 0) revert UnknownCohort();
        if (block.timestamp <= c.goalDeadline) revert TooEarly();
        if (c.settled) revert AlreadySettled();
        Stake storage st = stakes[cohortId][staker];
        if (st.goalHash == bytes32(0)) revert NotStaked();
        if (st.outcome != Outcome.None) revert AlreadyDecided();

        if (passed) {
            st.outcome = Outcome.Passed;
            c.passCount += 1;
        } else {
            st.outcome = Outcome.Failed;
            c.failCount += 1;
        }
        emit Verdict(cohortId, staker, passed, evidenceHash);
    }

    function settle(uint256 cohortId) external {
        Cohort storage c = cohorts[cohortId];
        if (c.stakeAmount == 0) revert UnknownCohort();
        if (block.timestamp < uint256(c.goalDeadline) + SETTLE_DELAY) revert TooEarly();
        if (c.settled) revert AlreadySettled();
        c.settled = true;
        // Nobody passed: nothing is forfeited, everyone is refunded.
        c.forfeitPool = c.passCount == 0 ? 0 : uint256(c.failCount) * c.stakeAmount;
        emit Settled(cohortId, c.passCount, c.forfeitPool);
    }

    /// @notice What claimFor would pay right now (0 if not settled, already claimed, or forfeited).
    function claimable(uint256 cohortId, address staker) public view returns (uint256) {
        Cohort storage c = cohorts[cohortId];
        Stake storage st = stakes[cohortId][staker];
        if (!c.settled || st.goalHash == bytes32(0) || st.claimed) return 0;
        if (c.passCount == 0 || st.outcome == Outcome.None) return c.stakeAmount;
        if (st.outcome == Outcome.Passed) return c.stakeAmount + c.forfeitPool / c.passCount;
        return 0;
    }

    /// @notice Anyone may trigger; funds always go to the staker.
    function claimFor(uint256 cohortId, address staker) external {
        Cohort storage c = cohorts[cohortId];
        if (!c.settled) revert NotSettled();
        Stake storage st = stakes[cohortId][staker];
        if (st.goalHash == bytes32(0)) revert NotStaked();
        if (st.claimed) revert AlreadyClaimed();
        uint256 amount = claimable(cohortId, staker);
        if (amount == 0) revert NothingToClaim();
        st.claimed = true;
        if (!IERC20(token).transfer(staker, amount)) revert TransferFailed();
        emit Claimed(cohortId, staker, amount);
    }
}
