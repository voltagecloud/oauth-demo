"use client";

import { useCallback, useEffect, useState } from "react";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Meter } from "@/components/ui/meter";
import {
  ApiError,
  apiFetch,
  type Denial,
  type DepositView,
  type LimitsResponse,
} from "@/lib/client-api";

const PRESETS = [500, 1_000, 2_500, 5_000];
const TERMINAL = new Set(["completed", "failed", "expired"]);

type Stage =
  | { name: "choose" }
  | { name: "invoice"; paymentId: string; amountSats: number }
  | { name: "credited"; amountSats: number }
  | { name: "denied"; denial: Denial; message: string };

/**
 * The cashier: pick an amount, get an invoice, pay it, get credits.
 *
 * Two things are worth noticing in here. The amount buttons are disabled
 * against the *remaining* allowance before anything is submitted, so the policy
 * is visible before it bites. And the denial screen is treated as a first-class
 * outcome rather than an error toast — it is the thing this demo exists to show.
 */
export function Cashier({
  limits,
  autopayAvailable,
  onRefreshLimits,
  onCredited,
  onClose,
}: {
  limits: LimitsResponse | null;
  autopayAvailable: boolean;
  onRefreshLimits: () => void;
  onCredited: (sats: number) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const [amount, setAmount] = useState(PRESETS[0]!);
  const [submitting, setSubmitting] = useState(false);
  const [deposit, setDeposit] = useState<DepositView | null>(null);
  const [autopaying, setAutopaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const remainingSats = limits?.usage.remaining.sats ?? 0;
  const remainingCount = limits?.usage.remaining.count ?? 0;

  const submit = useCallback(async () => {
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await apiFetch<{ paymentId: string; amountSats: number }>("/api/deposits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountSats: amount }),
      });
      setDeposit(null);
      setStage({ name: "invoice", paymentId: result.paymentId, amountSats: result.amountSats });
    } catch (cause) {
      if (cause instanceof ApiError && cause.denial) {
        setStage({ name: "denied", denial: cause.denial, message: cause.message });
      } else {
        setNotice(cause instanceof Error ? cause.message : "Could not start that deposit.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [amount]);

  // Depend on primitives, never on the `stage` object itself. An object
  // identity in the dependency list restarts the poll on every render, and a
  // poll that restarts on every render is an unthrottled request loop.
  const invoicePaymentId = stage.name === "invoice" ? stage.paymentId : null;
  const invoiceAmountSats = stage.name === "invoice" ? stage.amountSats : 0;

  // Poll the invoice until Voltage settles it. There is no push channel: every
  // mutating call answers 202 and does the work asynchronously.
  useEffect(() => {
    if (!invoicePaymentId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const next = await apiFetch<DepositView>(`/api/deposits/${invoicePaymentId}`);
        if (cancelled) return;
        setDeposit(next);

        if (next.status === "completed") {
          const settled = next.sats ?? invoiceAmountSats;
          onCredited(settled);
          onRefreshLimits();
          setStage({ name: "credited", amountSats: settled });
          return;
        }
        if (TERMINAL.has(next.status)) {
          setNotice(
            next.status === "expired"
              ? "That invoice expired before it was paid."
              : "That deposit failed at the Lightning layer.",
          );
          onRefreshLimits();
          setStage({ name: "choose" });
          return;
        }
      } catch (cause) {
        if (cancelled) return;
        setNotice(cause instanceof Error ? cause.message : "Lost track of that deposit.");
        return;
      }

      timer = setTimeout(() => void tick(), 1_500);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [invoicePaymentId, invoiceAmountSats, onCredited, onRefreshLimits]);

  const autopay = useCallback(async () => {
    if (!invoicePaymentId) return;
    setAutopaying(true);
    setNotice(null);
    try {
      await apiFetch(`/api/deposits/${invoicePaymentId}/autopay`, { method: "POST" });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Autopay failed.");
    } finally {
      setAutopaying(false);
    }
  }, [invoicePaymentId]);

  return (
    <div className="space-y-5">
      {limits ? (
        <div className="space-y-3">
          <Meter
            label="Deposits today"
            used={limits.usage.used.count}
            pending={limits.usage.pending.count}
            limit={limits.usage.limits.deposits}
            segments={limits.usage.limits.deposits}
            tone="banana"
          />
          <Meter
            label="Sats today"
            used={limits.usage.used.sats}
            pending={limits.usage.pending.sats}
            limit={limits.usage.limits.sats}
            segments={20}
            tone="cyan"
          />
        </div>
      ) : null}

      {notice ? (
        <p className="outline-chunk bg-tangerine/15 px-3 py-2 text-xs text-tangerine">{notice}</p>
      ) : null}

      {stage.name === "choose" ? (
        <ChooseAmount
          amount={amount}
          setAmount={setAmount}
          bounds={limits?.bounds}
          remainingSats={remainingSats}
          remainingCount={remainingCount}
          submitting={submitting}
          onSubmit={submit}
        />
      ) : null}

      {stage.name === "invoice" ? (
        <Invoice
          amountSats={stage.amountSats}
          deposit={deposit}
          autopayAvailable={autopayAvailable}
          autopaying={autopaying}
          onAutopay={autopay}
          onCancel={() => {
            setStage({ name: "choose" });
            onRefreshLimits();
          }}
        />
      ) : null}

      {stage.name === "credited" ? (
        <Credited
          amountSats={stage.amountSats}
          onAgain={() => setStage({ name: "choose" })}
          onClose={onClose}
        />
      ) : null}

      {stage.name === "denied" ? (
        <Denied
          denial={stage.denial}
          message={stage.message}
          onBack={() => {
            setStage({ name: "choose" });
            onRefreshLimits();
          }}
        />
      ) : null}
    </div>
  );
}

function ChooseAmount({
  amount,
  setAmount,
  bounds,
  remainingSats,
  remainingCount,
  submitting,
  onSubmit,
}: {
  amount: number;
  setAmount: (value: number) => void;
  bounds?: { minSats: number; maxSats: number };
  remainingSats: number;
  remainingCount: number;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const outOfDeposits = remainingCount <= 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((preset) => {
          const tooBig = preset > remainingSats;
          const outOfRange = bounds ? preset < bounds.minSats || preset > bounds.maxSats : false;
          const disabled = tooBig || outOfRange || outOfDeposits;

          return (
            <button
              key={preset}
              onClick={() => setAmount(preset)}
              disabled={disabled}
              title={
                outOfDeposits
                  ? "No deposits left today"
                  : tooBig
                    ? `Only ${remainingSats.toLocaleString()} sats left today`
                    : outOfRange
                      ? `Outside the ${bounds?.minSats}–${bounds?.maxSats} sat range`
                      : undefined
              }
              className={[
                "pixel-text outline-chunk px-3 py-4 text-sm transition-[transform,box-shadow] duration-75",
                "disabled:cursor-not-allowed disabled:opacity-35",
                amount === preset && !disabled
                  ? "hard-shadow-sm bg-banana text-ink"
                  : "bg-panel-2 text-bone hover:bg-panel-2/70",
              ].join(" ")}
            >
              {preset.toLocaleString()}
              <span className="ml-1 text-[10px] opacity-60">sats</span>
            </button>
          );
        })}
      </div>

      <Button
        tone="lime"
        className="w-full"
        disabled={submitting || outOfDeposits}
        onClick={onSubmit}
      >
        {submitting ? "Asking the house…" : outOfDeposits ? "Limit reached" : "Get invoice"}
      </Button>

      {outOfDeposits ? (
        <p className="pixel-text text-center text-[10px] text-tangerine">
          You have used every deposit allowed today.
        </p>
      ) : null}
    </div>
  );
}

function Invoice({
  amountSats,
  deposit,
  autopayAvailable,
  autopaying,
  onAutopay,
  onCancel,
}: {
  amountSats: number;
  deposit: DepositView | null;
  autopayAvailable: boolean;
  autopaying: boolean;
  onAutopay: () => void;
  onCancel: () => void;
}) {
  const bolt11 = deposit?.bolt11;

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="pixel-text text-xs text-cyan">
        Pay {amountSats.toLocaleString()} sats
      </p>

      {bolt11 ? (
        <QrCode value={bolt11.toUpperCase()} label="Lightning invoice QR code" className="w-56" />
      ) : (
        <div className="outline-chunk flex aspect-square w-56 items-center justify-center bg-panel-2">
          <span className="pixel-text animate-blink text-[11px] text-bone/60">Generating…</span>
        </div>
      )}

      {bolt11 ? (
        <p className="w-full break-all bg-ink/60 p-2 text-center font-mono text-[9px] text-bone/45">
          {bolt11.slice(0, 44)}…{bolt11.slice(-8)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {bolt11 ? <CopyButton value={bolt11} label="Copy invoice" /> : null}
        {autopayAvailable && bolt11 ? (
          <Button tone="magenta" onClick={onAutopay} disabled={autopaying}>
            {autopaying ? "Paying…" : "Pay from treasury"}
          </Button>
        ) : null}
      </div>

      <p className="pixel-text text-[10px] text-bone/40" role="status" aria-live="polite">
        {deposit?.status === "receiving" ? "Waiting for payment…" : "Preparing invoice…"}
      </p>

      <button onClick={onCancel} className="pixel-text text-[10px] text-bone/40 underline hover:text-bone">
        Back to amounts
      </button>
    </div>
  );
}

function Credited({
  amountSats,
  onAgain,
  onClose,
}: {
  amountSats: number;
  onAgain: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative flex flex-col items-center gap-4 overflow-hidden py-4">
      {/* Coin shower. Purely decorative, so it is hidden from assistive tech. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {Array.from({ length: 9 }, (_, index) => (
          <span
            key={index}
            className="animate-coin-drop absolute top-0 text-2xl"
            style={{ left: `${8 + index * 10}%`, animationDelay: `${index * 90}ms` }}
          >
            🪙
          </span>
        ))}
      </div>

      <p className="marquee-text-sm font-display text-2xl text-lime">Credited</p>
      <p className="pixel-text text-xs text-bone/70">
        {amountSats.toLocaleString()} sats are on the machine
      </p>

      <div className="flex gap-2">
        <Button tone="lime" onClick={onClose}>
          Back to the reels
        </Button>
        <Button tone="ghost" onClick={onAgain}>
          Deposit again
        </Button>
      </div>
    </div>
  );
}

function Denied({
  denial,
  message,
  onBack,
}: {
  denial: Denial;
  message: string;
  onBack: () => void;
}) {
  const resetsAt = "resetsAt" in denial ? new Date(denial.resetsAt) : null;

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <div className="animate-stamp-in outline-chunk hard-shadow bg-blood px-6 py-3">
        <p className="marquee-text-sm font-display text-xl text-bone">Cut off</p>
      </div>

      <p className="text-sm text-bone/80">{message}</p>

      {denial.kind !== "range" ? (
        <dl className="outline-chunk w-full bg-ink/60 p-3 text-left font-mono text-[11px]">
          <div className="flex justify-between py-0.5">
            <dt className="text-bone/45">limit hit</dt>
            <dd className="text-tangerine">
              {denial.kind === "quantity" ? "deposits per day" : "sats per day"}
            </dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-bone/45">used</dt>
            <dd className="text-bone">
              {denial.used.toLocaleString()} / {denial.limit.toLocaleString()}
            </dd>
          </div>
          {denial.kind === "amount" ? (
            <div className="flex justify-between py-0.5">
              <dt className="text-bone/45">requested</dt>
              <dd className="text-bone">{denial.requested.toLocaleString()}</dd>
            </div>
          ) : null}
          {resetsAt ? (
            <div className="flex justify-between py-0.5">
              <dt className="text-bone/45">resets</dt>
              <dd className="text-cyan">
                {resetsAt.toUTCString().replace("GMT", "UTC")}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <p className="pixel-text max-w-xs text-[9px] leading-relaxed text-bone/35">
        This decision came from counting the payments Voltage holds for this Google
        account today. Open the debug menu to see the query.
      </p>

      <Button tone="ghost" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
