import { z } from "zod";
import { apiError, handle, json } from "@/lib/api";
import { appTag, policyConfig, quoteConfig, voltageConfig, walletCurrency } from "@/lib/env";
import { denialMessage, evaluate, readUsage } from "@/lib/limits";
import { randomUUID } from "@/lib/ids";
import { currentPlayer, playerId } from "@/lib/session";
import { formatAmount } from "@/lib/money";
import { currentTrace } from "@/lib/trace";
import { createReceive } from "@/lib/voltage/payments";
import { quoteFor, remainingSeconds } from "@/lib/voltage/quotes";

export const dynamic = "force-dynamic";

/** Amount is in the wallet currency's base unit: cents for usd, msats for btc. */
const bodySchema = z.object({ amount: z.number().int().positive().max(100_000_000_000) });

/**
 * Mints a deposit invoice, if the policy allows one.
 *
 * Order matters: read the ledger, decide, *then* create anything. The invoice
 * is what gets counted, so minting it first would let a denied request still
 * consume the player's allowance.
 *
 * This never waits for the bolt11 string. Voltage answers `202` and generates
 * it asynchronously, so the handler returns the id it chose and the client
 * polls — which keeps it well inside the serverless execution ceiling.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const player = await currentPlayer();
    if (!player) {
      return apiError(401, "unauthenticated", "Sign in with Google to deposit.", {}, currentTrace());
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError(400, "invalid_request", "Choose a deposit amount.", {}, currentTrace());
    }

    const { amount } = parsed.data;
    const currency = walletCurrency();
    const id = playerId(player);

    const usage = await readUsage(id);
    const denial = evaluate(usage, amount);
    if (denial) {
      if (denial.kind === "range") {
        return apiError(
          400,
          "invalid_amount",
          denialMessage(denial, currency),
          { denial },
          currentTrace(),
        );
      }

      // A daily cap is a rate limit, so it answers 429 with `Retry-After`
      // pointing at the reset — the standard contract a client can act on
      // without parsing the body.
      const response = apiError(
        429,
        "policy_denied",
        denialMessage(denial, currency),
        {
          denial,
          usage: {
            used: usage.used,
            pending: usage.pending,
            remaining: usage.remaining,
            limits: usage.limits,
            resetsAt: usage.resetsAt,
          },
        },
        currentTrace(),
      );
      response.headers.set(
        "retry-after",
        String(Math.max(1, Math.ceil((new Date(usage.resetsAt).getTime() - Date.now()) / 1_000))),
      );
      return response;
    }

    const { walletId } = voltageConfig();
    const { invoiceExpirySeconds } = policyConfig();
    const paymentId = randomUUID();

    // A USD wallet has to lock an exchange rate before it can put an amount in
    // a bolt11 — bitcoin is what actually moves. Voltage rejects a USD receive
    // without a quote id, so this step is mandatory, not an optimisation.
    let quoteId: string | undefined;
    let expiry = invoiceExpirySeconds;

    if (currency === "usd") {
      const { lineOfCreditId, network } = quoteConfig();
      const quote = await quoteFor({
        id: randomUUID(),
        lineOfCreditId,
        network,
        amount: { currency: "usd", amount },
        to: "btc",
      });
      quoteId = quote.id;

      // The invoice cannot outlive the rate it was priced at; Voltage caps it
      // anyway, but asking for something impossible is a needless round trip.
      const left = remainingSeconds(quote);
      if (left !== null) expiry = Math.max(60, Math.min(expiry, left));
    }

    await createReceive({
      id: paymentId,
      walletId,
      amount,
      currency,
      quoteId,
      description: `Jungle Jackpot buy-in — ${formatAmount(amount, currency)}`,
      expirySeconds: expiry,
      // This is the whole trick. Voltage stores these and lets us filter on
      // them later, which is what makes it the ledger for the daily limits.
      metadata: {
        app: appTag(),
        player_id: id,
        player_email: player.email.slice(0, 256),
      },
    });

    return json({ paymentId, amount, currency }, currentTrace(), { status: 202 });
  });
}
