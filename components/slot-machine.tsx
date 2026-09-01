"use client";

import Image, { type StaticImageData } from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import bananaSprite from "./symbols/banana.png";
import gorillaSprite from "./symbols/gorilla.png";
import monkeySprite from "./symbols/monkey.png";
import parrotSprite from "./symbols/parrot.png";
import snakeSprite from "./symbols/snake.png";
import tigerSprite from "./symbols/tiger.png";

/**
 * The game.
 *
 * It is deliberately the least important code in the repo — credits are local
 * state and no payout is real. It exists so the deposit flow has somewhere to
 * deposit *to*, and so the limit denial lands in a context where it means
 * something ("you can't buy in again today") rather than as a bare API error.
 */

const SYMBOLS = ["monkey", "parrot", "tiger", "gorilla", "snake", "banana"] as const;
type ReelSymbol = (typeof SYMBOLS)[number];

/** 32x32 sprites, drawn at whole multiples so the pixel grid stays square. */
const SPRITES: Record<ReelSymbol, { src: StaticImageData; label: string }> = {
  monkey: { src: monkeySprite, label: "Monkey" },
  parrot: { src: parrotSprite, label: "Parrot" },
  tiger: { src: tigerSprite, label: "Tiger" },
  gorilla: { src: gorillaSprite, label: "Gorilla" },
  snake: { src: snakeSprite, label: "Snake" },
  banana: { src: bananaSprite, label: "Banana" },
};

const WILD: ReelSymbol = "banana";

/** The banana is wild. Three of anything pays; the tiger pays most. */
const PAYOUTS: Record<ReelSymbol, number> = {
  banana: 40,
  tiger: 30,
  gorilla: 20,
  parrot: 12,
  snake: 10,
  monkey: 8,
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
  const nonWild = reels.filter((symbol) => symbol !== WILD);
  const distinct = new Set(nonWild);

  if (distinct.size <= 1) {
    const symbol = nonWild[0] ?? WILD;
    return PAYOUTS[symbol] * SPIN_COST;
  }
  // Two of a kind (wilds included) returns the stake.
  if (new Set(reels).size === 2) return SPIN_COST;
  return 0;
}

/**
 * `unoptimized` because these are ~600-byte sprites: re-encoding them buys
 * nothing and risks resampling art whose whole point is its exact pixel grid.
 */
function Sprite({ symbol, alt }: { symbol: ReelSymbol; alt: string }) {
  return (
    <Image
      src={SPRITES[symbol].src}
      alt={alt}
      unoptimized
      className="pixel-sprite size-16 sm:size-24"
    />
  );
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
  const [reels, setReels] = useState<ReelSymbol[]>(["monkey", "parrot", "banana"]);
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
            {/* Kept mounted rather than rendered only while spinning: that way
                every sprite is fetched during the first paint, and the first
                spin cannot open onto empty cells waiting on the network. */}
            <div
              hidden={!spinning[index]}
              aria-hidden
              className="animate-reel-spin flex flex-col"
            >
              {[...SYMBOLS, ...SYMBOLS].map((s, i) => (
                <span key={i} className="flex h-20 items-center justify-center sm:h-24">
                  <Sprite symbol={s} alt="" />
                </span>
              ))}
            </div>

            {!spinning[index] && (
              <span key={`${index}-${symbol}`} className="animate-reel-land">
                <Sprite symbol={symbol} alt={SPRITES[symbol].label} />
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
