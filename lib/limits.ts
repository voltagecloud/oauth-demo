import { appTag, policyConfig } from "@/lib/env";
import { formatAmount, type WalletCurrency } from "@/lib/money";
import { listAllPayments, paymentAmount } from "@/lib/voltage/payments";
import type { Payment } from "@/lib/voltage/types";

/**
 * The deposit policy.
 *
 * Voltage has wallet-level policies — a ceiling on any single payment, a
 * per-minute transaction velocity — but nothing per-customer: it has no idea
 * who your users are. "Three deposits or $100 per Google account per day" is
 * therefore ours to enforce.
 *
 * What it is *not* is ours to store. Every invoice is tagged at creation with
 * the player's id, and `GET /payments` filters on `metadata[key]=value`, so
 * today's usage is one query against Voltage. No database, and no second source
 * of truth to drift out of step with the money.
 */

export interface Tally {
  count: number;
  /** Base units: cents for usd, msats for btc. */
  amount: number;
}

export interface Usage {
  /** Deposits that actually landed. */
  used: Tally;
  /** Invoices minted but not yet paid, held as reservations. */
  pending: Tally;
  limits: { deposits: number; amount: number };
  remaining: Tally;
  currency: WalletCurrency;
  windowStart: string;
  resetsAt: string;
  /** Newest first, for the on-screen history. */
  payments: Payment[];
}

export type Denial =
  | { kind: "quantity"; used: number; limit: number; resetsAt: string }
  | { kind: "amount"; used: number; limit: number; requested: number; resetsAt: string }
  | { kind: "range"; min: number; max: number; requested: number };

const COMPLETED = "completed";
/** Not yet paid, but already promised to someone. */
const IN_FLIGHT = new Set(["generating", "receiving"]);

/** Start of the counting window, and when it next resets. */
export function windowBounds(window: "utc_day" | "rolling"): { start: Date; resetsAt: Date } {
  const now = new Date();

  if (window === "rolling") {
    return { start: new Date(now.getTime() - 24 * 3_600_000), resetsAt: new Date(now.getTime() + 24 * 3_600_000) };
  }

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const resetsAt = new Date(start.getTime() + 24 * 3_600_000);
  return { start, resetsAt };
}

/**
 * Asks Voltage what this player has deposited in the current window.
 *
 * Statuses are filtered server-side so the response only contains rows that
 * count. `expired` and `failed` invoices are excluded outright — a player who
 * let an invoice lapse should not lose a slot for the day.
 */
export async function readUsage(playerId: string, currency: WalletCurrency): Promise<Usage> {
  const { maxDepositsPerDay, maxAmountPerDay, window } = policyConfig(currency);
  const { start, resetsAt } = windowBounds(window);

  const payments = await listAllPayments({
    direction: "receive",
    metadata: { app: appTag(), player_id: playerId },
    statuses: ["completed", "receiving", "generating"],
    startDate: start.toISOString(),
  });

  const used: Tally = { count: 0, amount: 0 };
  const pending: Tally = { count: 0, amount: 0 };

  for (const payment of payments) {
    const bucket = payment.status === COMPLETED ? used : IN_FLIGHT.has(payment.status) ? pending : null;
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += paymentAmount(payment, currency);
  }

  return {
    used,
    pending,
    limits: { deposits: maxDepositsPerDay, amount: maxAmountPerDay },
    remaining: {
      count: Math.max(0, maxDepositsPerDay - used.count - pending.count),
      amount: Math.max(0, maxAmountPerDay - used.amount - pending.amount),
    },
    currency,
    windowStart: start.toISOString(),
    resetsAt: resetsAt.toISOString(),
    payments,
  };
}

/**
 * Decides whether a requested deposit is allowed. `null` means yes.
 *
 * In-flight invoices count against both caps. The reference implementation only
 * counted settled payments, which let a player mint invoices in parallel and
 * overshoot the daily total by paying them all at once.
 */
export function evaluate(usage: Usage, requested: number): Denial | null {
  const { minDeposit, maxDeposit } = policyConfig(usage.currency);

  if (requested < minDeposit || requested > maxDeposit) {
    return { kind: "range", min: minDeposit, max: maxDeposit, requested };
  }

  const usedCount = usage.used.count + usage.pending.count;
  if (usedCount + 1 > usage.limits.deposits) {
    return { kind: "quantity", used: usedCount, limit: usage.limits.deposits, resetsAt: usage.resetsAt };
  }

  const usedAmount = usage.used.amount + usage.pending.amount;
  if (usedAmount + requested > usage.limits.amount) {
    return {
      kind: "amount",
      used: usedAmount,
      limit: usage.limits.amount,
      requested,
      resetsAt: usage.resetsAt,
    };
  }

  return null;
}

export function denialMessage(denial: Denial, currency: WalletCurrency): string {
  const money = (value: number) => formatAmount(value, currency);

  switch (denial.kind) {
    case "range":
      return `Deposits must be between ${money(denial.min)} and ${money(denial.max)}.`;
    case "quantity":
      return `Daily deposit limit reached — ${denial.used} of ${denial.limit} used.`;
    case "amount":
      return `Daily amount limit reached — ${money(denial.used)} of ${money(denial.limit)} used, and this deposit is ${money(denial.requested)}.`;
  }
}
