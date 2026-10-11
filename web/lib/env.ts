import deployments from "@shared/deployments.json";

const clean = (u: string | null | undefined) => (u || "").replace(/\/$/, "");

// NEXT_PUBLIC_* overrides shared/deployments.json; NEXT_PUBLIC_MOCK=1 forces fixtures (rehearsal, screenshots).
const FORCE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
export const RELAYER_URL = FORCE_MOCK ? "" : clean(process.env.NEXT_PUBLIC_RELAYER_URL || deployments.relayer_url);
export const REFEREE_URL = FORCE_MOCK ? "" : clean(process.env.NEXT_PUBLIC_REFEREE_URL || deployments.referee_url);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";
export const WEB_URL = clean(process.env.NEXT_PUBLIC_WEB_URL || deployments.web_url);

/** Each service falls back to lib/fixtures.ts on its own until it has a URL. */
export const MOCK_RELAYER = !RELAYER_URL;
export const MOCK_REFEREE = !REFEREE_URL;
export const MOCK = MOCK_RELAYER || MOCK_REFEREE;

export const EXPLORER = "https://sepolia.basescan.org";
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
