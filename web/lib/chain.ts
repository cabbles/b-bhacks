import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { RPC_URL } from "./env";

export const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL), batch: { multicall: true } });

// The contract fragments the web app uses (contracts/src/*.sol).
export const poolAbi = parseAbi([
  "event CohortCreated(uint256 indexed cohortId, bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount)",
  "event Staked(uint256 indexed cohortId, address indexed staker, bytes32 goalHash)",
  "event Verdict(uint256 indexed cohortId, address indexed staker, bool passed, bytes32 evidenceHash)",
  "function cohortCount() view returns (uint256)",
  "function cohorts(uint256) view returns (bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount, uint32 stakerCount, uint32 passCount, uint32 failCount, bool settled, uint256 forfeitPool)",
  "function stakes(uint256 cohortId, address staker) view returns (bytes32 goalHash, uint8 outcome, bool claimed)",
  "function claimable(uint256 cohortId, address staker) view returns (uint256)",
  "function authNonce(uint256 cohortId, bytes32 goalHash) pure returns (bytes32)",
  "function createCohort(bytes32 ruleHash, uint64 stakeDeadline, uint64 goalDeadline, uint256 stakeAmount) returns (uint256)",
  "function stake(uint256 cohortId, bytes32 goalHash)",
  "function settle(uint256 cohortId)",
  "function claimFor(uint256 cohortId, address staker)",
]);

export const marketAbi = parseAbi([
  "function stakePool() view returns (address)",
  "function markets(bytes32) view returns (uint256 yesTotal, uint256 noTotal, uint8 result)",
  "function positions(bytes32, address) view returns (uint256 yesAmount, uint256 noAmount, bool claimed)",
  "function claimable(uint256 cohortId, address owner, address bettor) view returns (uint256)",
  "function bet(uint256 cohortId, address owner, bool yes, uint256 amount)",
  "function resolve(uint256 cohortId, address owner)",
  "function claimFor(uint256 cohortId, address owner, address bettor)",
]);

export const bondAbi = parseAbi([
  "function bonds(bytes32) view returns (uint256 amount, uint8 result)",
  "function claimable(uint256 cohortId, address owner, address bettor) view returns (uint256)",
  "function bond(uint256 cohortId, uint256 amount)",
  "function resolve(uint256 cohortId, address owner)",
  "function claimFor(uint256 cohortId, address owner, address bettor)",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

export const faucetAbi = parseAbi(["function requestFunds(address to)"]);

/** MarketPool and CommitmentBond key every market by keccak256(abi.encode(cohortId, owner)). */
export const marketIdOf = (cohortId: number | bigint, owner: `0x${string}`) =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [BigInt(cohortId), owner]));

/** StakePool.authNonce, mirrored so the status page can check the web and the pool agree. */
export const authNonce = (cohortId: number | bigint, goalHash: `0x${string}`) =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [BigInt(cohortId), goalHash]));
