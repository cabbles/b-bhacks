import deployments from "@shared/deployments.json";

const clean = (u: string | null | undefined) => (u || "").replace(/\/$/, "");
const addr = (a: unknown) => (typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a) && !/^0x0{40}$/.test(a) ? (a as `0x${string}`) : null);

// NEXT_PUBLIC_* overrides shared/deployments.json; NEXT_PUBLIC_MOCK=1 forces fixtures (rehearsal, screenshots).
const FORCE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
export const REFEREE_URL = FORCE_MOCK ? "" : clean(process.env.NEXT_PUBLIC_REFEREE_URL || deployments.referee_url);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";
export const WEB_URL = clean(process.env.NEXT_PUBLIC_WEB_URL || deployments.web_url);

const dep = deployments as Record<string, unknown>;
export const ADDRESSES = {
  pool: addr(dep.pool),
  market: addr(dep.market_pool),
  bond: addr(dep.bond_pool),
  token: addr(dep.token) ?? ("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as const),
  // Agora testnet faucet: requestFunds(address) sends test AUSD to any address.
  faucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as const,
};

/** Each side falls back to lib/fixtures.ts on its own: the chain until the pool is deployed, the referee until it has a URL. */
export const MOCK_CHAIN = FORCE_MOCK || !ADDRESSES.pool;
export const MOCK_REFEREE = !REFEREE_URL;
export const MOCK = MOCK_CHAIN || MOCK_REFEREE;

export const EXPLORER = "https://sepolia.basescan.org";
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
export const ETH_FAUCET_URL = "https://docs.base.org/base-chain/tools/network-faucets";
export const METAMASK_URL = "https://metamask.io/download/";
