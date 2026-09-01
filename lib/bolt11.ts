import { decode } from "light-bolt11-decoder";

/**
 * The amount encoded in a bolt11 invoice, in millisatoshis.
 *
 * Paying an invoice from a USD wallet needs its bitcoin amount, both to quote
 * against and to submit with the payment — and the Voltage docs are explicit
 * that it comes from the invoice string, not the payment record: on a USD
 * receive the API reports `requested_amount` and `data.amount` in *cents*, so
 * there is no bitcoin figure to read off the response.
 *
 * The invoice is also the right source on principle. It is what the payer will
 * actually be charged, so decoding it cannot disagree with what gets paid.
 */
export function invoiceMsats(paymentRequest: string): number | undefined {
  try {
    const decoded = decode(paymentRequest) as {
      sections?: { name?: string; value?: string | number }[];
    };

    const amount = decoded.sections?.find((section) => section.name === "amount")?.value;
    if (amount === undefined || amount === null) return undefined;

    const msats = typeof amount === "string" ? Number.parseInt(amount, 10) : amount;
    // An amountless invoice decodes to zero, which is not a payable figure.
    return Number.isFinite(msats) && msats > 0 ? msats : undefined;
  } catch {
    // Not a bolt11 we can read. The caller reports this rather than guessing.
    return undefined;
  }
}
