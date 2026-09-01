"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { PlayerView } from "@/lib/client-api";

/** The PLAYER 1 strip. Credits, identity, and a way out. */
export function Hud({
  credits,
  player,
  onSignOut,
}: {
  credits: number;
  player: PlayerView | null;
  onSignOut: () => void;
}) {
  return (
    <header className="outline-chunk sticky top-0 z-30 border-x-0 border-t-0 bg-ink/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2">
        <span className="pixel-text shrink-0 text-[11px] text-magenta">Player 1</span>

        <span className="pixel-text shrink-0 text-[11px] text-bone/50">
          Credits{" "}
          <span className="text-banana tabular-nums">{String(credits).padStart(4, "0")}</span>
        </span>

        <span className="flex-1" />

        {player ? (
          <>
            <span className="flex min-w-0 items-center gap-2">
              {player.picture ? (
                <Image
                  src={player.picture}
                  alt=""
                  width={22}
                  height={22}
                  className="outline-chunk shrink-0 border-2"
                  unoptimized
                />
              ) : null}
              <span className="pixel-text hidden truncate text-[10px] text-bone/70 sm:inline">
                {player.email}
              </span>
            </span>
            <button
              onClick={onSignOut}
              className="pixel-text shrink-0 text-[10px] text-bone/40 underline hover:text-bone"
            >
              Sign out
            </button>
          </>
        ) : (
          <span className="pixel-text animate-blink text-[10px] text-cyan">Insert coin</span>
        )}
      </div>
    </header>
  );
}

/** The scrolling marquee under the logo. Pure decoration. */
export function Marquee({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    <div
      aria-hidden
      className="outline-chunk overflow-hidden border-x-0 bg-grape/40 py-1"
    >
      <div className="animate-marquee-slide flex w-max gap-8 whitespace-nowrap">
        {doubled.map((item, index) => (
          <span key={index} className="pixel-text text-[10px] text-bone/70">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export { Button };
