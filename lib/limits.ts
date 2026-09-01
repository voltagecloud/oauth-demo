import { appTag, policyConfig } from "@/lib/env";
import { listAllPayments, paymentSats } from "@/lib/voltage/payments";
import type { Payment } from "@/lib/voltage/types";

/**
 * The deposit policy.
 *
 * Voltage has wallet-level policies — a ceiling on any single payment, a
 * per-minute transaction velocity — but nothing per-customer: it has no idea
 * who your users are. "Seven deposits or ten thousand sats per Google account
 * per day" is therefore ours to enforce.
 *
 * What it is *not* is ours to store. Every invoice is tagged at creation with
 * the player's id, and `GET /payments` filters on `metadata[key]=value`, so
 * today's usage is one query against Voltage. No database, and no second source
 * of truth to drift out of step with the money.
 */

export interface Tally {
  count: number;
  sats: number;
}

export interface Usage {
  /** Deposits that actually landed. */
  used: Tally;
  /** Invoices minted but not yet paid, held as reservations. */
  pending: Tally;
  limits: { deposits: number; sats: number };
  remaining: Tally;
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
export function windowBounds(): { start: Date; resetsAt: Date } {
  const { window } = policyConfig();
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
export async function readUsage(playerId: string): Promise<Usage> {
  const { maxDepositsPerDay, maxSatsPerDay } = policyConfig();
  const { start, resetsAt } = windowBounds();

  const payments = await listAllPayments({
    direction: "receive",
    metadata: { app: appTag(), player_id: playerId },
    statuses: ["completed", "receiving", "generating"],
    startDate: start.toISOString(),
  });

  const used: Tally = { count: 0, sats: 0 };
  const pending: Tally = { count: 0, sats: 0 };

  for (const payment of payments) {
    const bucket = payment.status === COMPLETED ? used : IN_FLIGHT.has(payment.status) ? pending : null;
    if (!bucket) continue;
    bucket.count += 1;
    bucket.sats += paymentSats(payment);
  }

  return {
    used,
    pending,
    limits: { deposits: maxDepositsPerDay, sats: maxSatsPerDay },
    remaining: {
      count: Math.max(0, maxDepositsPerDay - used.count - pending.count),
      sats: Math.max(0, maxSatsPerDay - used.sats - pending.sats),
    },
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
export function evaluate(usage: Usage, requestedSats: number): Denial | null {
  const { minDepositSats, maxDepositSats } = policyConfig();

  if (requestedSats < minDepositSats || requestedSats > maxDepositSats) {
    return { kind: "range", min: minDepositSats, max: maxDepositSats, requested: requestedSats };
  }

  const usedCount = usage.used.count + usage.pending.count;
  if (usedCount + 1 > usage.limits.deposits) {
    return { kind: "quantity", used: usedCount, limit: usage.limits.deposits, resetsAt: usage.resetsAt };
  }

  const usedSats = usage.used.sats + usage.pending.sats;
  if (usedSats + requestedSats > usage.limits.sats) {
    return {
      kind: "amount",
      used: usedSats,
      limit: usage.limits.sats,
      requested: requestedSats,
      resetsAt: usage.resetsAt,
    };
  }

  return null;
}

export function denialMessage(denial: Denial): string {
  switch (denial.kind) {
    case "range":
      return `Deposits must be between ${denial.min.toLocaleString()} and ${denial.max.toLocaleString()} sats.`;
    case "quantity":
      return `Daily deposit limit reached — ${denial.used} of ${denial.limit} used.`;
    case "amount":
      return `Daily amount limit reached — ${denial.used.toLocaleString()} of ${denial.limit.toLocaleString()} sats used, and this deposit is ${denial.requested.toLocaleString()}.`;
  }
}
