"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The game.
 *
 * It is deliberately the least important code in the repo — credits are local
 * state and no payout is real. It exists so the deposit flow has somewhere to
 * deposit *to*, and so the limit denial lands in a context where it means
 * something ("you can't buy in again today") rather than as a bare API error.
 */

const SYMBOLS = ["🐒", "🦜", "🐅", "🦍", "🐍", "🍌"] as const;
type ReelSymbol = (typeof SYMBOLS)[number];

/** The banana is wild. Three of anything pays; the tiger pays most. */
const PAYOUTS: Record<ReelSymbol, number> = {
  "🍌": 40,
  "🐅": 30,
  "🦍": 20,
  "🦜": 12,
  "🐍": 10,
  "🐒": 8,
};

const SPIN_COST = 5;
const SPIN_MS = [620, 840, 1_060];

function randomSymbol(): ReelSymbol {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!;
}

interface Outcome {
  reels: ReelSymbol[];
  win: number;
}

function settle(reels: ReelSymbol[]): number {
  const [a, b, c] = reels;
  if (!a || !b || !c) return 0;

  // Bananas substitute for anything.
  const nonWild = reels.filter((symbol) => symbol !== "🍌");
  const distinct = new Set(nonWild);

  if (distinct.size <= 1) {
    const symbol = nonWild[0] ?? "🍌";
    return PAYOUTS[symbol] * SPIN_COST;
  }
  // Two of a kind (wilds included) returns the stake.
  if (new Set(reels).size === 2) return SPIN_COST;
  return 0;
}

export function SlotMachine({
  credits,
  onSpend,
  onWin,
  onOutOfCredits,
}: {
  credits: number;
  onSpend: (amount: number) => void;
  onWin: (amount: number) => void;
  onOutOfCredits: () => void;
}) {
  const [reels, setReels] = useState<ReelSymbol[]>(["🐒", "🦜", "🍌"]);
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const busy = spinning.some(Boolean);

  const spin = useCallback(() => {
    if (busy) return;
    if (credits < SPIN_COST) {
      onOutOfCredits();
      return;
    }

    onSpend(SPIN_COST);
    setOutcome(null);
    setSpinning([true, true, true]);

    const next = [randomSymbol(), randomSymbol(), randomSymbol()];

    timers.current = SPIN_MS.map((delay, index) =>
      setTimeout(() => {
        setReels((current) => current.map((symbol, i) => (i === index ? next[index]! : symbol)));
        setSpinning((current) => current.map((value, i) => (i === index ? false : value)));

        if (index === SPIN_MS.length - 1) {
          const win = settle(next);
          setOutcome({ reels: next, win });
          if (win > 0) onWin(win);
        }
      }, delay),
    );
  }, [busy, credits, onOutOfCredits, onSpend, onWin]);

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Reel window */}
      <div className="outline-chunk hard-shadow relative flex gap-2 bg-ink p-3 sm:gap-3 sm:p-4">
        {reels.map((symbol, index) => (
          <div
            key={index}
            className="outline-chunk relative flex size-20 items-center justify-center overflow-hidden bg-bone sm:size-24"
          >
            {spinning[index] ? (
              <div className="animate-reel-spin flex flex-col">
                {[...SYMBOLS, ...SYMBOLS].map((s, i) => (
                  <span key={i} className="flex h-20 items-center justify-center text-4xl sm:h-24 sm:text-5xl">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <span
                key={`${index}-${symbol}`}
                className="animate-reel-land text-4xl sm:text-5xl"
                role="img"
                aria-label={`Reel ${index + 1}`}
              >
                {symbol}
              </span>
            )}
          </div>
        ))}

        {/* Payline */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-magenta/70" />
      </div>

      <div
        className="pixel-text flex h-6 items-center text-xs"
        role="status"
        aria-live="polite"
      >
        {busy ? (
          <span className="text-cyan">Spinning…</span>
        ) : outcome ? (
          outcome.win > 0 ? (
            <span className="text-lime">Winner — {outcome.win} credits</span>
          ) : (
            <span className="text-bone/45">No match. Again?</span>
          )
        ) : (
          <span className="text-bone/45">{SPIN_COST} credits a spin</span>
        )}
      </div>

      <button
        onClick={spin}
        disabled={busy}
        className={[
          "pixel-text outline-chunk hard-shadow bg-lime px-10 py-4 text-base text-ink",
          "transition-[transform,box-shadow] duration-75",
          "active:translate-x-[6px] active:translate-y-[6px] active:shadow-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          credits >= SPIN_COST && !busy ? "animate-pulse-glow" : "",
        ].join(" ")}
      >
        Spin
      </button>
    </div>
  );
}

export { SPIN_COST };
