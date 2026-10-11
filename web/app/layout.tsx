import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { MOCK, MOCK_REFEREE, MOCK_RELAYER } from "@/lib/env";
import { Backdrop } from "@/components/Backdrop";
import GradientText from "@/components/reactbits/GradientText";

export const metadata: Metadata = {
  title: "AI Referee",
  description: "Stake testnet AUSD on finishing something. An AI referee checks the evidence itself.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#09090b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="relative min-h-dvh">
        <Backdrop />
        <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/60 backdrop-blur-xl">
          <nav className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-black tracking-tight">
              <GradientText colors={["#a3e635", "#22d3ee", "#a78bfa", "#a3e635"]} animationSpeed={6}>
                AI Referee
              </GradientText>
            </Link>
            <div className="ml-auto flex gap-4 text-zinc-300">
              <Link href="/stake" className="hover:text-white">Stake</Link>
              <Link href="/cohorts/1" className="hover:text-white">Board</Link>
              <Link href="/fool" className="hover:text-white">Fool the Ref</Link>
            </div>
          </nav>
        </header>
        {MOCK && (
          <div className="bg-amber-500/15 px-4 py-1 text-center text-xs text-amber-300">
            Mock mode: {MOCK_RELAYER && MOCK_REFEREE ? "relayer and referee" : MOCK_RELAYER ? "relayer" : "referee"} not
            configured, showing fixtures.
          </div>
        )}
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-3xl px-4 pb-10 pt-4 text-xs text-zinc-500">
          Testnet only (Base Sepolia). Tokens have no value. Nobody, including the operator, can withdraw stakes.
        </footer>
      </body>
    </html>
  );
}
