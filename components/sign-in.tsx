"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode } from "@/components/qr-code";
import { Button, ButtonLink } from "@/components/ui/button";
import { apiFetch, type PlayerView } from "@/lib/client-api";

interface LinkResponse {
  handoffId: string;
  linkUrl: string;
  startUrl: string;
  expiresAt: string;
}

/**
 * Cross-device sign-in.
 *
 * The laptop opens a handoff and shows its URL as a QR code. The player can
 * scan it and finish on their phone, or click through in this browser — both
 * land on the same Google flow. While that happens this component polls, and
 * the poll that comes back approved is the one that carries the session cookie.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (player: PlayerView) => void }) {
  const [link, setLink] = useState<LinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const startedRef = useRef(false);

  // Open the handoff once on mount. A ref rather than a state flag so React's
  // development double-invoke doesn't mint two of them.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    apiFetch<LinkResponse>("/api/link", { method: "POST" })
      .then(setLink)
      .catch((cause: Error) => setError(cause.message));
  }, []);

  // Poll until the other device (or this one) finishes with Google.
  useEffect(() => {
    if (!link) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const result = await fetch(`/api/link/${encodeURIComponent(link.handoffId)}`, {
          cache: "no-store",
        });
        if (cancelled) return;

        if (result.status === 404) {
          setError("That sign-in link expired. Reload to start another.");
          return;
        }

        const payload = (await result.json()) as { status: string; player?: PlayerView };
        if (payload.status === "approved" && payload.player) {
          onSignedIn(payload.player);
          return;
        }
      } catch {
        // A dropped poll is not fatal; the next tick retries.
      }

      timer = setTimeout(() => void tick(), 1_500);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link, onSignedIn]);

  // Countdown to the handoff's expiry, so a stale QR is obviously stale.
  useEffect(() => {
    if (!link) return;
    const expiry = new Date(link.expiresAt).getTime();
    const update = () => setSecondsLeft(Math.max(0, Math.round((expiry - Date.now()) / 1_000)));
    update();
    const interval = setInterval(update, 1_000);
    return () => clearInterval(interval);
  }, [link]);

  if (error) {
    return (
      <div className="space-y-3 text-center">
        <p className="pixel-text text-xs text-blood">{error}</p>
        <Button tone="cyan" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="text-center">
        <h2 className="marquee-text-sm font-display text-2xl text-banana sm:text-3xl">Prove it&apos;s you</h2>
        <p className="mt-2 max-w-sm text-sm text-bone/70">
          The house limits how much any one player can deposit per day. That needs a name
          to count against, so sign in with Google before you buy in.
        </p>
      </div>

      {link ? (
        <>
          <QrCode value={link.linkUrl} label="Scan to sign in on your phone" className="w-52" />

          <div className="text-center">
            <p className="pixel-text text-[11px] text-cyan">Scan with your phone</p>
            {secondsLeft !== null ? (
              <p className="pixel-text mt-1 text-[10px] text-bone/40">
                {secondsLeft > 0
                  ? `Link expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
                  : "Link expired — reload the page"}
              </p>
            ) : null}
          </div>

          <div className="flex w-full max-w-xs items-center gap-3">
            <span className="h-1 flex-1 bg-bone/15" />
            <span className="pixel-text text-[10px] text-bone/40">or</span>
            <span className="h-1 flex-1 bg-bone/15" />
          </div>

          <ButtonLink tone="cyan" href={link.startUrl}>
            Continue in this browser
          </ButtonLink>

          <p className="pixel-text max-w-xs text-center text-[9px] leading-relaxed text-bone/35">
            Either way you end up signed in here. The phone hands the identity back to
            this screen — it does not leave you stranded on the small device.
          </p>
        </>
      ) : (
        <div className="outline-chunk aspect-square w-52 animate-pulse bg-panel-2" />
      )}
    </div>
  );
}
