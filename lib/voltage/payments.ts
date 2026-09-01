import { voltageConfig } from "@/lib/env";
import { voltageRequest } from "./client";
import type { Payment, PaymentStatus, PaymentsPage } from "./types";

function envPath(): string {
  const { organizationId, environmentId } = voltageConfig();
  return `/organizations/${organizationId}/environments/${environmentId}`;
}

interface CreateReceiveParams {
  /** Client-generated UUID. Voltage also treats it as the idempotency key. */
  id: string;
  walletId: string;
  amountMsats: number;
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
      amount: { currency: "btc", amount: params.amountMsats },
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
  metadata?: Record<string, string>;
}

/** Pays a bolt11 invoice. Also `202`; poll for the terminal status. */
export async function createSend(params: CreateSendParams): Promise<void> {
  await voltageRequest(`${envPath()}/payments`, {
    method: "POST",
    body: {
      id: params.id,
      wallet_id: params.walletId,
      currency: "btc",
      type: "bolt11",
      data: {
        payment_request: params.paymentRequest,
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

/** Sats an invoice was minted for, preferring the non-deprecated fields. */
export function paymentSats(payment: Payment): number {
  const amount = payment.requested_amount ?? payment.data?.amount;
  if (!amount || amount.currency !== "btc") return 0;
  return Math.round(amount.amount / 1_000);
}
