import { voltageConfig } from "@/lib/env";
import { voltageRequest } from "./client";
import type { WalletCurrency } from "@/lib/money";
import type { Payment, PaymentStatus, PaymentsPage } from "./types";

function envPath(): string {
  const { organizationId, environmentId } = voltageConfig();
  return `/organizations/${organizationId}/environments/${environmentId}`;
}

interface CreateReceiveParams {
  /** Client-generated UUID. Voltage also treats it as the idempotency key. */
  id: string;
  walletId: string;
  /** Base units: msats for btc, cents for usd. */
  amount: number;
  currency: WalletCurrency;
  /** Required for USD wallets — the locked conversion rate. */
  quoteId?: string;
  description?: string;
  /** Seconds. Voltage default is 3600, max 86400. */
  expirySeconds?: number;
  /** Up to 50 entries, keys and values capped at 256 characters each. */
  metadata?: Record<string, string>;
}

/**
 * Requests a bolt11 invoice.
 *
 * Answers `202` with an empty body and generates the invoice asynchronously —
 * poll `getPayment(id)` for `data.payment_request`.
 */
export async function createReceive(params: CreateReceiveParams): Promise<void> {
  await voltageRequest(`${envPath()}/payments`, {
    method: "POST",
    body: {
      id: params.id,
      wallet_id: params.walletId,
      payment_kind: "bolt11",
      amount: { currency: params.currency, amount: params.amount },
      // Omitted entirely for btc; mandatory for usd.
      quote_id: params.quoteId,
      description: params.description,
      expiration: params.expirySeconds,
      metadata: params.metadata,
    },
  });
}

interface CreateSendParams {
  id: string;
  walletId: string;
  paymentRequest: string;
  maxFeeMsats: number;
  /** The paying wallet's currency — not the invoice's. */
  currency: WalletCurrency;
  /** Required when paying from a USD wallet: the locked BTC→USD rate. */
  quoteId?: string;
  /**
   * The invoice's exact amount on the bitcoin rail, in msats. Required
   * alongside a quote so Voltage can check the two agree exactly.
   */
  amountMsats?: number;
  metadata?: Record<string, string>;
}

/**
 * Pays a bolt11 invoice. Also `202`; poll for the terminal status.
 *
 * A USD wallet has to quote its sends as well as its receives — bitcoin is what
 * leaves the wallet, so the dollar cost has to be fixed first. The rail amount
 * stays in BTC throughout so the quote and the payment can be compared for
 * exact equality.
 */
export async function createSend(params: CreateSendParams): Promise<void> {
  await voltageRequest(`${envPath()}/payments`, {
    method: "POST",
    body: {
      id: params.id,
      wallet_id: params.walletId,
      currency: params.currency,
      type: "bolt11",
      quote_id: params.quoteId,
      data: {
        payment_request: params.paymentRequest,
        amount:
          params.amountMsats === undefined
            ? undefined
            : { currency: "btc", amount: params.amountMsats },
        max_fee: { currency: "btc", amount: params.maxFeeMsats },
      },
      metadata: params.metadata,
    },
  });
}

export async function getPayment(paymentId: string): Promise<Payment> {
  return voltageRequest<Payment>(`${envPath()}/payments/${paymentId}`);
}

export interface ListPaymentsParams {
  /** Filters as `metadata[key]=value`; all supplied pairs must match. */
  metadata?: Record<string, string>;
  direction?: "send" | "receive";
  statuses?: PaymentStatus[];
  /** Inclusive lower bound on creation time, RFC 3339. */
  startDate?: string;
  walletId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Lists payments, filtered server-side.
 *
 * The `metadata` filter is the load-bearing part of this demo: tag invoices
 * with the player's Google subject at creation and Voltage will answer "what
 * has this person deposited today?" without an application database.
 */
export async function listPayments(params: ListPaymentsParams): Promise<PaymentsPage> {
  return voltageRequest<PaymentsPage>(`${envPath()}/payments`, {
    query: {
      metadata: params.metadata,
      direction: params.direction,
      statuses: params.statuses,
      start_date: params.startDate,
      wallet_id: params.walletId,
      limit: params.limit ?? 100,
      sort_key: "created_at",
      sort_order: "DESC",
      // Cursor pagination; `offset` is deprecated. The cursor is bound to the
      // filters and sort above, so those must not change between pages.
      pagination: "cursor",
      cursor: params.cursor,
    },
  });
}

/** Follows `next_cursor` to the end. Bounded so a runaway history can't hang a request. */
export async function listAllPayments(
  params: ListPaymentsParams,
  maxPages = 10,
): Promise<Payment[]> {
  const all: Payment[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await listPayments({ ...params, cursor });
    all.push(...(result.items ?? []));
    cursor = result.next_cursor ?? undefined;
    if (!cursor || result.has_more === false) break;
  }

  return all;
}

/**
 * The invoice's amount on the bitcoin rail, in msats — what actually moves over
 * Lightning, whatever currency the wallet is denominated in.
 *
 * On a quoted (USD) receive this is `requested_amount`; on a bitcoin receive
 * it is `data.amount`. Paying such an invoice from a USD wallet needs this
 * exact number, both to quote against and to submit with the payment.
 */
export function btcRailMsats(payment: Payment): number | undefined {
  for (const amount of [payment.requested_amount, payment.data?.amount]) {
    if (amount && amount.currency === "btc") return amount.amount;
  }
  return undefined;
}

/**
 * What an invoice was minted for, in the wallet currency's base unit.
 *
 * The field to read depends on the currency, and getting it backwards is
 * silent rather than loud. On a *quoted* (USD) receive, `requested_amount` is
 * the converted **bitcoin rail** amount, while `data.amount` carries the USD
 * cents the customer was actually asked for. Summing `requested_amount` against
 * a dollar cap would compare msats to cents and produce a plausible, wrong
 * number — so match on currency and take the field that agrees.
 */
export function paymentAmount(payment: Payment, currency: WalletCurrency): number {
  const candidates = [payment.data?.amount, payment.requested_amount];
  for (const amount of candidates) {
    if (amount && amount.currency === currency) return amount.amount;
  }
  return 0;
}
