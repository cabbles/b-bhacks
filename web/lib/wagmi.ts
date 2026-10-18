import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";
import { RPC_URL } from "./env";

// Browser wallets only (MetaMask, Rabby, Coinbase Wallet extension, ...). Installed wallets announce themselves
// (EIP-6963) and show up by name; `injected` is the fallback for older ones.
export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http(RPC_URL) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
