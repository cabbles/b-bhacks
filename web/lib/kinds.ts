import { keccak256, stringToHex } from "viem";
import type { Cohort } from "./types";

// Each on-chain round carries a tag in its ruleHash so the app can tell the two features apart.
export const SOLO_TAG = keccak256(stringToHex("cashcow:solo"));
export const GROUP_TAG = keccak256(stringToHex("cashcow:group"));

/** A proper one-person prediction market (older untagged rounds are left out of market lists). */
export const isMarket = (c?: Pick<Cohort, "rule_hash"> | null) => c?.rule_hash?.toLowerCase() === GROUP_TAG;

export type Kind = "solo" | "group";
/** Solo rounds are tagged; everything else (group markets and older untagged rounds) is a group market. */
export const kindOf = (c?: Pick<Cohort, "rule_hash"> | null): Kind =>
  c?.rule_hash?.toLowerCase() === SOLO_TAG ? "solo" : "group";

/** A market's StakePool entry: the smallest token unit, refunded. The creator's real stake is their CommitmentBond. */
export const MARKET_ENTRY = 1n;
