"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Cashier } from "@/components/cashier";
import { DebugMenu } from "@/components/debug-menu";
import { Hud, Marquee } from "@/components/hud";
import { SignIn } from "@/components/sign-in";
import { SlotMachine } from "@/components/slot-machine";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { apiFetch, setTraceSink, type LimitsResponse, type PlayerView } from "@/lib/client-api";
import type { TraceEntry } from "@/lib/trace";

const MARQUEE = [
  "★ JUNGLE JACKPOT ★",
  "SIGN IN TO BUY IN",
  "DEPOSITS RATE LIMITED PER GOOGLE ACCOUNT",
  "POWERED BY THE VOLTAGE PAYMENTS API",
  "NO HOSTED CHECKOUT — JUST THE API",
];

type Screen = "game" | "signin" | "cashier";

const MAX_TRACE_ENTRIES = 200;

function authErrorMessage(reason: string): string {
  if (reason === "cancelled") return "Sign-in was cancelled.";
  if (reason === "expired") return "That sign-in link expired before you finished. Try again.";
  return `Sign-in failed (${reason}). Check the Google client id, secret and redirect URI.`;
}

export function GameShell() {
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [autopayAvailable, setAutopayAvailable] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [limits, setLimits] = useState<LimitsResponse | null>(null);
  const [credits, setCredits] = useState(0);
  const [screen, setScreen] = useState<Screen>("game");
  const [trace, setTrace] = useState<TraceEntry[]>([]);

  // Derived from the URL rather than copied into state by an effect: the OAuth
  // callback reports failures as `?auth_error=…`, and the only extra state that
  // needs to exist is whether the player has dismissed the message.
  const searchParams = useSearchParams();
  const authErrorReason = searchParams.get("auth_error");
  const [authErrorDismissed, setAuthErrorDismissed] = useState(false);
  const authError =
    authErrorReason && !authErrorDismissed ? authErrorMessage(authErrorReason) : null;

  // Every API response carries the Voltage calls that produced it; funnel them
  // into the debug panel from one place rather than at each call site.
  useEffect(() => {
    setTraceSink((entries) =>
      // Bounded: polling adds an entry every couple of seconds, and an
      // unbounded list would grow all session.
      setTrace((current) => [...current, ...entries].slice(-MAX_TRACE_ENTRIES)),
    );
    return () => setTraceSink(null);
  }, []);

  const refreshLimits = useCallback(async () => {
    try {
      setLimits(await apiFetch<LimitsResponse>("/api/limits"));
    } catch {
      // Not fatal: the meters simply stay as they were.
    }
  }, []);

  useEffect(() => {
    apiFetch<{ player: PlayerView | null; autopayAvailable: boolean }>("/api/auth/session")
      .then((result) => {
        setPlayer(result.player);
        setAutopayAvailable(result.autopayAvailable);
        if (result.player) void refreshLimits();
      })
      .catch(() => {})
      .finally(() => setSessionLoaded(true));
  }, [refreshLimits]);

  const handleSignedIn = useCallback(
    (next: PlayerView) => {
      setPlayer(next);
      setAuthErrorDismissed(true);
      setScreen("cashier");
      void refreshLimits();
    },
    // setAuthErrorDismissed is a stable setter, but the React Compiler infers
    // it as a dependency and refuses to optimise the component without it.
    [refreshLimits, setAuthErrorDismissed],
  );

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    setPlayer(null);
    setLimits(null);
    setScreen("game");
  }, []);

  const creditPlayer = useCallback((sats: number) => {
    setCredits((value) => value + sats);
  }, []);

  const spend = useCallback((amount: number) => {
    setCredits((value) => value - amount);
  }, []);

  const closeCashier = useCallback(() => setScreen("game"), []);

  const openCashier = useCallback(() => {
    setScreen(player ? "cashier" : "signin");
    if (player) void refreshLimits();
  }, [player, refreshLimits]);

  return (
    <div className="min-h-dvh pb-20">
      <Hud credits={credits} player={player} onSignOut={signOut} />
      <Marquee items={MARQUEE} />

      <main className="mx-auto max-w-5xl px-3 py-6 sm:py-10">
        <div className="mb-8 text-center">
          <h1 className="marquee-text font-display text-4xl leading-none text-banana sm:text-6xl">
            Jungle
            <span className="block text-magenta">Jackpot</span>
          </h1>
          <p className="pixel-text mt-3 text-[10px] text-cyan sm:text-[11px]">
            Deposit limits by Google account · Voltage Payments API
          </p>
        </div>

        {authError ? (
          <div className="outline-chunk mx-auto mb-6 flex max-w-xl items-start gap-3 bg-blood/20 px-3 py-2">
            <p className="flex-1 text-xs text-blood">{authError}</p>
            <button
              onClick={() => {
                setAuthErrorDismissed(true);
                // Drop the parameter so a refresh doesn't resurrect the message.
                window.history.replaceState({}, "", window.location.pathname);
              }}
              aria-label="Dismiss"
              className="pixel-text shrink-0 text-[11px] text-blood/70 hover:text-blood"
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* --- The machine --------------------------------------------- */}
          <Panel label="Jungle Jackpot · 3 reel" tone="magenta">
            <div className="flex flex-col items-center gap-6 py-2">
              <SlotMachine
                credits={credits}
                onSpend={spend}
                onWin={creditPlayer}
                onOutOfCredits={openCashier}
              />

              {credits <= 0 ? (
                <div className="text-center">
                  <p className="pixel-text animate-blink mb-3 text-xs text-banana">
                    Insert coin
                  </p>
                  <Button tone="banana" onClick={openCashier}>
                    Cashier
                  </Button>
                </div>
              ) : (
                <Button tone="ghost" onClick={openCashier}>
                  Cashier
                </Button>
              )}
            </div>
          </Panel>

          {/* --- The cage ------------------------------------------------- */}
          <div className="space-y-6">
            <Panel
              label={screen === "signin" ? "Cage · identity" : "Cage · deposits"}
              tone={screen === "signin" ? "cyan" : "banana"}
            >
              {!sessionLoaded ? (
                <p className="pixel-text py-8 text-center text-[11px] text-bone/40">Loading…</p>
              ) : screen === "signin" || (screen === "cashier" && !player) ? (
                <SignIn onSignedIn={handleSignedIn} />
              ) : screen === "cashier" && player ? (
                <Cashier
                  limits={limits}
                  autopayAvailable={autopayAvailable}
                  onRefreshLimits={refreshLimits}
                  onCredited={creditPlayer}
                  onClose={closeCashier}
                />
              ) : (
                <Idle player={player} limits={limits} onOpen={openCashier} />
              )}
            </Panel>

            {limits?.walletPolicy ? <PolicyPanel limits={limits} /> : null}
          </div>
        </div>

        <HowItWorks />
      </main>

      <DebugMenu entries={trace} onClear={() => setTrace([])} />
    </div>
  );
}

function Idle({
  player,
  limits,
  onOpen,
}: {
  player: PlayerView | null;
  limits: LimitsResponse | null;
  onOpen: () => void;
}) {
  return (
    <div className="space-y-4 py-2 text-center">
      {player ? (
        <>
          <p className="pixel-text text-[11px] text-lime">Signed in</p>
          <p className="truncate text-sm text-bone/70">{player.email}</p>
          {limits ? (
            <p className="pixel-text text-[10px] text-bone/45">
              {limits.usage.remaining.count} of {limits.usage.limits.deposits} deposits left ·{" "}
              {limits.usage.remaining.sats.toLocaleString()} sats
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-bone/70">
          Buy in to play. You will need a Google account first — the house counts deposits
          per person.
        </p>
      )}
      <Button tone="banana" onClick={onOpen}>
        {player ? "Deposit" : "Sign in & deposit"}
      </Button>
    </div>
  );
}

/**
 * Both enforcement layers, side by side.
 *
 * The distinction is the single most useful thing an integrator can take away:
 * Voltage polices the wallet, you police the customer, and only one of those is
 * something the API can do for you.
 */
function PolicyPanel({ limits }: { limits: LimitsResponse }) {
  const policy = limits.walletPolicy!;

  return (
    <Panel label="Policy · two layers" tone="grape">
      <dl className="space-y-3 font-mono text-[11px]">
        <div>
          <dt className="pixel-text mb-1 text-[10px] text-cyan">Voltage enforces</dt>
          <dd className="space-y-0.5 text-bone/70">
            {policy.maxPaymentSizeSats !== undefined ? (
              <p className="flex justify-between">
                <span className="text-bone/45">max payment size</span>
                <span>{policy.maxPaymentSizeSats.toLocaleString()} sats</span>
              </p>
            ) : null}
            {policy.transactionsPerMinute !== undefined ? (
              <p className="flex justify-between">
                <span className="text-bone/45">transactions / min</span>
                <span>{policy.transactionsPerMinute.toLocaleString()}</span>
              </p>
            ) : null}
            <p className="pt-1 text-[10px] leading-relaxed text-bone/35">
              Wallet-level, applies to everyone. Read from{" "}
              <span className="text-bone/60">GET /wallets/{"{id}"}/policies</span>.
            </p>
          </dd>
        </div>

        <div className="border-t border-bone/10 pt-3">
          <dt className="pixel-text mb-1 text-[10px] text-banana">This app enforces</dt>
          <dd className="space-y-0.5 text-bone/70">
            <p className="flex justify-between">
              <span className="text-bone/45">deposits / day</span>
              <span>{limits.usage.limits.deposits}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-bone/45">sats / day</span>
              <span>{limits.usage.limits.sats.toLocaleString()}</span>
            </p>
            <p className="pt-1 text-[10px] leading-relaxed text-bone/35">
              Per Google account. Voltage has no concept of your customers, so this one is
              yours to build — counted from the payment metadata.
            </p>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function HowItWorks() {
  const steps = [
    ["1 · Identity", "Google OAuth, authorization code + PKCE. The QR hands the flow to a phone and back."],
    ["2 · Tag", "POST /payments mints a bolt11 invoice carrying metadata.player_id."],
    ["3 · Count", "GET /payments?metadata[player_id]=… is the ledger. No database."],
    ["4 · Decide", "Over the daily count or sats? No invoice gets minted at all."],
  ];

  return (
    <section className="mt-10">
      <h2 className="pixel-text mb-3 text-center text-[11px] text-bone/50">How it works</h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([title, detail]) => (
          <li key={title} className="outline-chunk hard-shadow-sm bg-deep p-3">
            <p className="pixel-text mb-1.5 text-[10px] text-lime">{title}</p>
            <p className="text-[11px] leading-relaxed text-bone/60">{detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
