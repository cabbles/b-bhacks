import type { Cohort } from "./types";

// Each on-chain round carries a tag in its ruleHash so the app can tell the two features apart.
// keccak256("cashcow:solo") and keccak256("cashcow:group").
export const SOLO_TAG = "0x416252916541b8054ea5d4d1c6da5970a0b054e52232954e3f6c1cab76874c85";
export const GROUP_TAG = "0x5a05ea52b7adfc2c950dd65ee2aa5bd7c39481f5fb3c11666d103147fd1c6487";

/** A proper one-person prediction market (older untagged rounds are left out of market lists). */
export const isMarket = (c?: Pick<Cohort, "rule_hash"> | null) => c?.rule_hash?.toLowerCase() === GROUP_TAG;

export type Kind = "solo" | "group";
/** Solo rounds are tagged; everything else (group markets and older untagged rounds) is a group market. */
export const kindOf = (c?: Pick<Cohort, "rule_hash"> | null): Kind =>
  c?.rule_hash?.toLowerCase() === SOLO_TAG ? "solo" : "group";
