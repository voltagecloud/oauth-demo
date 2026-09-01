import { voltageConfig } from "@/lib/env";
import { pollUntil, voltageRequest } from "./client";

/**
 * Currency conversion quotes.
 *
 * A USD wallet cannot mint an invoice on its own: bitcoin is what actually
 * moves over Lightning, so Voltage needs a locked exchange rate before it can
 * turn "$10.00" into an amount to put in a bolt11. That lock is a quote, and
 * `POST /payments` refuses a USD receive without one.
 *
 * Quotes are single-use and short-lived, which is why one is minted per
 * deposit rather than cached.
 */

function envPath(): string {
  const { organizationId, environmentId } = voltageConfig();
  return `/organizations/${organizationId}/environments/${environmentId}`;
}

export interface QuoteRead {
  id: string;
  quote?: unknown | null;
  created_at?: string | null;
  consumed_at?: string | null;
  expires_at?: string | null;
  failed_at?: string | null;
  error?: unknown | null;
}

export class QuoteFailedError extends Error {
  constructor(readonly detail: unknown) {
    super("Voltage could not price this deposit. The conversion quote failed.");
    this.name = "QuoteFailedError";
  }
}

interface CreateQuoteParams {
  /** Client-generated UUID, same contract as payment ids. */
  id: string;
  lineOfCreditId: string;
  network: string;
  /** Amount to convert *from*, in its own base unit. */
  amount: { currency: "usd" | "btc"; amount: number };
  /** Currency to convert into. */
  to: "btc" | "usd";
}

/** Requests a quote. Answers `202`; poll for the rate. */
export async function createQuote(params: CreateQuoteParams): Promise<void> {
  await voltageRequest(`${envPath()}/quotes`, {
    method: "POST",
    body: {
      id: params.id,
      line_of_credit_id: params.lineOfCreditId,
      network: params.network,
      amount: params.amount,
      to: params.to,
    },
  });
}

export async function getQuote(quoteId: string): Promise<QuoteRead> {
  return voltageRequest<QuoteRead>(`${envPath()}/quotes/${quoteId}`);
}

/** A quote is usable only when priced, unconsumed, unexpired and not failed. */
export function isUsable(quote: QuoteRead): boolean {
  if (quote.failed_at || quote.error) return false;
  if (!quote.quote || !quote.created_at) return false;
  if (quote.consumed_at) return false;
  if (quote.expires_at && new Date(quote.expires_at).getTime() <= Date.now()) return false;
  return true;
}

/** Seconds of life left, so an invoice is never given a longer expiry than its quote. */
export function remainingSeconds(quote: QuoteRead): number | null {
  if (!quote.expires_at) return null;
  return Math.max(0, Math.floor((new Date(quote.expires_at).getTime() - Date.now()) / 1_000));
}

/** Mints a quote and waits for it to become usable. */
export async function quoteFor(params: CreateQuoteParams): Promise<QuoteRead> {
  await createQuote(params);

  return pollUntil(
    () => getQuote(params.id),
    (quote) => {
      if (quote.failed_at || quote.error) throw new QuoteFailedError(quote.error);
      return isUsable(quote);
    },
    { label: "the conversion quote" },
  );
}
