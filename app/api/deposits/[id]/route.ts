import { apiError, handle, json } from "@/lib/api";
import { appTag, walletCurrency } from "@/lib/env";
import { isUuid } from "@/lib/ids";
import { currentPlayer, playerId } from "@/lib/session";
import { currentTrace } from "@/lib/trace";
import { getPayment, paymentAmount } from "@/lib/voltage/payments";
import { VoltageError } from "@/lib/voltage/client";

export const dynamic = "force-dynamic";

/**
 * What the client polls while the invoice is generated and then paid.
 *
 * Ownership is checked against the metadata Voltage holds, not against anything
 * the caller supplied, so a payment id alone does not expose someone else's
 * invoice.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const player = await currentPlayer();
    if (!player) return apiError(401, "unauthenticated", "Sign in to view this deposit.", {}, currentTrace());

    const { id } = await ctx.params;
    if (!isUuid(id)) {
      return apiError(400, "invalid_id", "That is not a payment id.", {}, currentTrace());
    }

    let payment;
    try {
      payment = await getPayment(id);
    } catch (error) {
      // Reads are eventually consistent: a GET right after the 202 can 404 for
      // a moment. That is "not ready", not "gone".
      if (error instanceof VoltageError && error.isNotFound) {
        return json({ status: "generating", bolt11: null, amount: null }, currentTrace());
      }
      throw error;
    }

    const metadata = payment.metadata ?? {};
    if (metadata.player_id !== playerId(player) || metadata.app !== appTag()) {
      // Deliberately 404, not 403: a player who guesses an id should not
      // learn whether it exists. (It also survives Netlify's proxy, which
      // retries 403s as static-file lookups.)
      return apiError(404, "not_found", "No such deposit.", {}, currentTrace());
    }

    return json(
      {
        id: payment.id,
        status: payment.status,
        bolt11: payment.data?.payment_request ?? null,
        amount: paymentAmount(payment, walletCurrency()),
        currency: walletCurrency(),
        createdAt: payment.created_at,
        updatedAt: payment.updated_at,
      },
      currentTrace(),
    );
  });
}
