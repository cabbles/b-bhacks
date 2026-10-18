// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StakePool, IERC20, IERC3009} from "./StakePool.sol";
import {MarketPool} from "./MarketPool.sol";

/// @title CommitmentBond
/// @notice The task owner's own stake in a prediction market, kept separate from the YES/NO bets.
///         Owner passes (or no verdict): gets exactly the bond back, never more.
///         Owner fails: the bond goes to the NO bettors pro rata to their NO bets; if nobody bet NO, it is burned.
///         Verdicts come from StakePool and NO bets from MarketPool, so all three always agree.
///         No owner/operator withdrawal exists.
contract CommitmentBond {
    enum Result {
        Pending,
        Returned,
        ToNo,
        Burned
    }

    struct Bond {
        uint256 amount;
        Result result;
    }

    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    StakePool public immutable stakePool;
    MarketPool public immutable marketPool;
    address public immutable token;

    mapping(bytes32 => Bond) public bonds;
    mapping(bytes32 => mapping(address => bool)) public noClaimed;
    bool private entered;

    event Bonded(bytes32 indexed marketId, uint256 indexed cohortId, address indexed owner, uint256 amount);
    event Resolved(bytes32 indexed marketId, Result result);
    event Claimed(bytes32 indexed marketId, address indexed bettor, uint256 amount);

    error BadParams();
    error NoCommitment();
    error AlreadyBonded();
    error BondingClosed();
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

    constructor(address marketPool_) {
        if (marketPool_ == address(0)) revert BadParams();
        marketPool = MarketPool(marketPool_);
        stakePool = marketPool.stakePool();
        token = marketPool.token();
    }

    /// Same id as the MarketPool market for this task.
    function marketId(uint256 cohortId, address owner) public pure returns (bytes32) {
        return keccak256(abi.encode(cohortId, owner));
    }

    /// The ERC-3009 nonce the owner signs: binds the authorization to this task and amount.
    function bondNonce(uint256 cohortId, address owner, uint256 amount) public pure returns (bytes32) {
        return keccak256(abi.encode("cashcow:bond", cohortId, owner, amount));
    }

    /// Owner posts their bond while betting is open. Anyone may relay it; funds come only from the owner's signature.
    function bondWithAuthorization(
        uint256 cohortId,
        address owner,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        bytes32 id = _recordBond(cohortId, owner, amount, nonce);
        IERC3009(token).receiveWithAuthorization(owner, address(this), amount, validAfter, validBefore, nonce, v, r, s);
        emit Bonded(id, cohortId, owner, amount);
    }

    /// Owner posts their bond from their own wallet: approve this contract for `amount` first. Works with any wallet.
    function bond(uint256 cohortId, uint256 amount) external nonReentrant {
        bytes32 id = _recordBond(cohortId, msg.sender, amount, bondNonce(cohortId, msg.sender, amount));
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Bonded(id, cohortId, msg.sender, amount);
    }

    function _recordBond(uint256 cohortId, address owner, uint256 amount, bytes32 nonce) private returns (bytes32 id) {
        if (owner == address(0) || amount == 0) revert BadParams();
        (bytes32 goalHash,,) = stakePool.stakes(cohortId, owner);
        if (goalHash == bytes32(0)) revert NoCommitment();
        (, uint64 bettingCloses,,,,,, bool settled,) = stakePool.cohorts(cohortId);
        if (block.timestamp >= bettingCloses || settled) revert BondingClosed();
        if (nonce != bondNonce(cohortId, owner, amount)) revert BadNonce();
        id = marketId(cohortId, owner);
        if (bonds[id].amount != 0) revert AlreadyBonded();
        bonds[id].amount = amount;
    }

    /// Anyone, once StakePool has settled the round. Pays the owner back or burns in the same call.
    function resolve(uint256 cohortId, address owner) external nonReentrant {
        bytes32 id = marketId(cohortId, owner);
        Bond storage b = bonds[id];
        if (b.amount == 0) revert NoCommitment();
        if (b.result != Result.Pending) revert AlreadyResolved();
        (,,,,,,, bool settled,) = stakePool.cohorts(cohortId);
        if (!settled) revert NotSettled();
        (, StakePool.Outcome outcome,) = stakePool.stakes(cohortId, owner);
        if (outcome != StakePool.Outcome.Failed) {
            b.result = Result.Returned;
            _pay(owner, b.amount);
        } else {
            (, uint256 noTotal,) = marketPool.markets(id);
            if (noTotal == 0) {
                b.result = Result.Burned;
                _pay(BURN, b.amount);
            } else {
                b.result = Result.ToNo;
            }
        }
        emit Resolved(id, b.result);
    }

    /// A NO bettor's share of a failed owner's bond.
    function claimable(uint256 cohortId, address owner, address bettor) public view returns (uint256) {
        bytes32 id = marketId(cohortId, owner);
        Bond storage b = bonds[id];
        if (b.result != Result.ToNo || noClaimed[id][bettor]) return 0;
        (, uint256 noAmount,) = marketPool.positions(id, bettor);
        (, uint256 noTotal,) = marketPool.markets(id);
        return b.amount * noAmount / noTotal;
    }

    /// Anyone may trigger; funds always go to the bettor.
    function claimFor(uint256 cohortId, address owner, address bettor) external nonReentrant {
        uint256 amount = claimable(cohortId, owner, bettor);
        if (amount == 0) revert NothingToClaim();
        bytes32 id = marketId(cohortId, owner);
        noClaimed[id][bettor] = true;
        _pay(bettor, amount);
        emit Claimed(id, bettor, amount);
    }

    function _pay(address to, uint256 amount) private {
        if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
    }
}
