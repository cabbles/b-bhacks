import { keccak256, toBytes } from "viem";
import { canonical } from "@shared/canonical";
import type { Criteria, Verdict } from "./types";

// PLAN.md 4.2 / 4.3: hashes are keccak256 of the UTF-8 canonical JSON.
export const goalHashOf = (c: Criteria) => keccak256(toBytes(canonical(c)));
export const evidenceHashOf = (v: Verdict) => keccak256(toBytes(canonical(v)));
