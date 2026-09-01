"use client";

import type { TraceEntry } from "@/lib/trace";

/** Mirrors what the route handlers return. Kept hand-written and small. */

export interface PlayerView {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export type WalletCurrency = "btc" | "usd";

export interface Tally {
  count: number;
  /** Base units: cents for usd, msats for btc. */
  amount: number;
}

export interface UsageView {
  used: Tally;
  pending: Tally;
  remaining: Tally;
  limits: { deposits: number; amount: number };
  windowStart: string;
  resetsAt: string;
  window: "utc_day" | "rolling";
}

export interface DepositRow {
  id: string;
  status: string;
  amount: number;
  createdAt: string;
}

export interface WalletPolicyView {
  maxPaymentSizeSats?: number;
  transactionsPerMinute?: number;
  sendVolumeLimitSats?: number;
  updatedAt?: string;
}

export interface LimitsResponse {
  usage: UsageView;
  deposits: DepositRow[];
  bounds: { min: number; max: number };
  currency: WalletCurrency;
  /** Where the currency came from: detected from the wallet, or overridden. */
  currencySource: "wallet" | "env" | "mixed";
  network: string;
  /** Deposit button denominations, in base units, chosen server-side. */
  presets: number[];
  walletPolicy: WalletPolicyView | null;
}

export interface DepositView {
  id: string;
  status: string;
  bolt11: string | null;
  amount: number | null;
  currency?: WalletCurrency;
}

export type Denial =
  | { kind: "quantity"; used: number; limit: number; resetsAt: string }
  | { kind: "amount"; used: number; limit: number; requested: number; resetsAt: string }
  | { kind: "range"; min: number; max: number; requested: number };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly denial?: Denial,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Where the debug panel gets fed from. Set by `apiFetch` on every call. */
let traceSink: ((entries: TraceEntry[]) => void) | null = null;

export function setTraceSink(sink: ((entries: TraceEntry[]) => void) | null) {
  traceSink = sink;
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  const trace = payload._trace as TraceEntry[] | undefined;
  if (trace?.length) traceSink?.(trace);

  if (!response.ok) {
    const error = (payload.error ?? {}) as Record<string, unknown>;
    throw new ApiError(
      response.status,
      String(error.code ?? "error"),
      String(error.message ?? `Request failed (${response.status})`),
      error.denial as Denial | undefined,
    );
  }

  return payload as T;
}
