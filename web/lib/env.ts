export const RELAYER_URL = (process.env.NEXT_PUBLIC_RELAYER_URL || "").replace(/\/$/, "");
export const REFEREE_URL = (process.env.NEXT_PUBLIC_REFEREE_URL || "").replace(/\/$/, "");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";
export const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "";

/** Mock mode: no backend URLs configured. Every call is served from lib/fixtures.ts. */
export const MOCK = !RELAYER_URL || !REFEREE_URL;

export const EXPLORER = "https://sepolia.basescan.org";
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
