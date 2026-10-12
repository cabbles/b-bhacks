"use client";
import { Cow } from "./Cow";

/** Cow tumbles around the screen while a bet confirms, then stops with a speech bubble. */
export function BetCelebration({ phase }: { phase: "spinning" | "done" }) {
  if (phase === "spinning") {
    return (
      <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-live="polite" aria-label="Confirming your bet">
        <div className="absolute left-1/2 top-1/2">
          <div className="cow-orbit">
            <div className="-translate-x-1/2 -translate-y-1/2">
              <Cow full size={132} />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center" aria-live="polite">
      <div className="flex flex-col items-center">
        <div className="relative mb-4 rounded-3xl border-[3px] border-fg bg-white px-5 py-3 font-display text-3xl font-bold leading-none text-fg shadow-[4px_4px_0_#1E1E1E]">
          Bet confirmed!
          <span className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b-[3px] border-r-[3px] border-fg bg-white" />
        </div>
        <Cow full size={168} />
      </div>
    </div>
  );
}
