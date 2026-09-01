import { apiError, handle, json } from "@/lib/api";
import { appTag, treasuryWalletId } from "@/lib/env";
import { derivedUuid, isUuid } from "@/lib/ids";
import { currentPlayer, playerId } from "@/lib/session";
import { currentTrace } from "@/lib/trace";
import { createSend, getPayment } from "@/lib/voltage/payments";

export const dynamic = "force-dynamic";

/**
 * Demo helper: settles a pending invoice from a treasury wallet in the same
 * Voltage environment, so the whole flow can be shown without a mutinynet
 * wallet on hand. Both wallets sit in one environment, so the payment
 * short-circuits rather than touching the Lightning Network.
 *
 * The money is worthless test sats, but the route is still locked down, because
 * an open "spend from the treasury" endpoint is a bad thing to publish:
 *
 *   1. It requires a session. No cookie, no route.
 *   2. Ownership is verified against the metadata *Voltage* holds, never
 *      against anything the caller sent, so a player can only settle an
 *      invoice they themselves minted.
 *   3. It only exists when VOLTAGE_TREASURY_WALLET_ID is configured.
 *   4. It only pays invoices still in `receiving`.
 *   5. The invoice could only have been minted by passing the daily caps, so
 *      this can never move more money than the policy already permitted.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const treasury = treasuryWalletId();
    if (!treasury) {
      return apiError(404, "not_configured", "Autopay is not enabled on this deployment.", {}, currentTrace());
    }

    const player = await currentPlayer();
    if (!player) {
      return apiError(401, "unauthenticated", "Sign in to use the autopay helper.", {}, currentTrace());
    }

    const { id } = await ctx.params;
    if (!isUuid(id)) {
      return apiError(400, "invalid_id", "That is not a payment id.", {}, currentTrace());
    }

    const payment = await getPayment(id);

    const metadata = payment.metadata ?? {};
    if (metadata.player_id !== playerId(player) || metadata.app !== appTag()) {
      // Deliberately 404, not 403: a player who guesses an id should not
      // learn whether it exists. (It also survives Netlify's proxy, which
      // retries 403s as static-file lookups.)
      return apiError(404, "not_found", "No such deposit.", {}, currentTrace());
    }

    if (payment.status !== "receiving" || !payment.data?.payment_request) {
      return apiError(
        409,
        "not_payable",
        `That invoice is ${payment.status}, not waiting for payment.`,
        { status: payment.status },
        currentTrace(),
      );
    }

    // Derived from the invoice id, so a double-tap replays the same payment id
    // and Voltage rejects the duplicate instead of paying twice.
    const sendId = derivedUuid(`autopay:${payment.id}`);

    await createSend({
      id: sendId,
      walletId: treasury,
      paymentRequest: payment.data.payment_request,
      // Internal transfer: it should cost nothing, but leave headroom rather
      // than have the payment rejected over a 1 msat routing fee.
      maxFeeMsats: 1_000,
      metadata: { app: appTag(), source: "autopay", settles: payment.id },
    });

    return json({ sendId, settles: payment.id }, currentTrace(), { status: 202 });
  });
}
