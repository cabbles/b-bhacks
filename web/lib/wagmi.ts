import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { baseAccount } from "wagmi/connectors/baseAccount";
import { injected } from "wagmi/connectors/injected";
import { RPC_URL } from "./env";

// Two ways in: a Base Account (passkey smart wallet, gas sponsored) or any browser wallet such as MetaMask.
export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [baseAccount({ appName: "Cash Cow" }), injected()],
  transports: { [baseSepolia.id]: http(RPC_URL) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
