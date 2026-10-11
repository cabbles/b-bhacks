import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { RPC_URL } from "./env";

export const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

// The StakePool fragments the web app reads (contracts/src/StakePool.sol on agent-a).
export const poolAbi = parseAbi([
  "event Verdict(uint256 indexed cohortId, address indexed staker, bool passed, bytes32 evidenceHash)",
  "function stakes(uint256 cohortId, address staker) view returns (bytes32 goalHash, uint8 outcome, bool claimed)",
  "function claimable(uint256 cohortId, address staker) view returns (uint256)",
  "function authNonce(uint256 cohortId, bytes32 goalHash) pure returns (bytes32)",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);
