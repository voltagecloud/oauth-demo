"use client";

import { ButtonLink } from "@/components/ui/button";

/**
 * The small-screen half of the cross-device sign-in.
 *
 * Deliberately one thing per screen: this is being read on a phone, held at
 * arm's length, by someone who is looking at a laptop.
 */
export function LinkScreen({
  state,
  handoffId,
}: {
  state: "ready" | "done" | "expired";
  handoffId: string;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-5 py-10 text-center">
      <h1 className="marquee-text font-display text-3xl leading-none text-banana">
        Jungle
        <span className="block text-magenta">Jackpot</span>
      </h1>

      {state === "ready" ? (
        <>
          <p className="max-w-xs text-sm text-bone/70">
            Sign in to unlock the cashier on the big screen. Your daily deposit limit is
            counted against this account.
          </p>
          <ButtonLink
            tone="cyan"
            href={`/api/auth/google/start?handoff=${encodeURIComponent(handoffId)}`}
          >
            Continue with Google
          </ButtonLink>
        </>
      ) : null}

      {state === "done" ? (
        <>
          <div className="outline-chunk hard-shadow bg-lime px-6 py-3">
            <p className="marquee-text-sm font-display text-xl text-ink">You&apos;re in</p>
          </div>
          <p className="max-w-xs text-sm text-bone/70">
            Head back to the big screen — the cashier is open there. You can close this tab.
          </p>
        </>
      ) : null}

      {state === "expired" ? (
        <>
          <div className="outline-chunk bg-blood/20 px-5 py-3">
            <p className="pixel-text text-xs text-blood">Link expired</p>
          </div>
          <p className="max-w-xs text-sm text-bone/70">
            Sign-in links last five minutes. Start again from the machine to get a fresh
            QR code.
          </p>
        </>
      ) : null}

      <p className="pixel-text max-w-xs text-[9px] leading-relaxed text-bone/30">
        Demo environment. The sats are mutinynet test sats and are worth nothing.
      </p>
    </main>
  );
}
