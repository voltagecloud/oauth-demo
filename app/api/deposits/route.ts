import { z } from "zod";
import { apiError, handle, json } from "@/lib/api";
import { satsToMsats } from "@/lib/amounts";
import { appTag, policyConfig, voltageConfig } from "@/lib/env";
import { denialMessage, evaluate, readUsage } from "@/lib/limits";
import { randomUUID } from "@/lib/ids";
import { currentPlayer, playerId } from "@/lib/session";
import { currentTrace } from "@/lib/trace";
import { createReceive } from "@/lib/voltage/payments";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ amountSats: z.number().int().positive().max(100_000_000) });

/**
 * Mints a deposit invoice, if the policy allows one.
 *
 * Order matters: read the ledger, decide, *then* create the invoice. The
 * invoice is what gets counted, so creating it first would let a denied request
 * still consume the player's allowance.
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
      return apiError(400, "invalid_request", "Choose a deposit amount in sats.", {}, currentTrace());
    }

    const { amountSats } = parsed.data;
    const id = playerId(player);

    const usage = await readUsage(id);
    const denial = evaluate(usage, amountSats);
    if (denial) {
      // A daily cap is a rate limit, so it answers 429 with `Retry-After`
      // pointing at the reset — the standard contract a client can act on
      // without parsing the body. An out-of-range amount is just a bad
      // request and is not the policy's business.
      if (denial.kind === "range") {
        return apiError(400, "invalid_amount", denialMessage(denial), { denial }, currentTrace());
      }

      const response = apiError(
        429,
        "policy_denied",
        denialMessage(denial),
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

    await createReceive({
      id: paymentId,
      walletId,
      amountMsats: satsToMsats(amountSats),
      description: `Jungle Jackpot buy-in — ${amountSats} sats`,
      expirySeconds: invoiceExpirySeconds,
      // This is the whole trick. Voltage stores these and lets us filter on
      // them later, which is what makes it the ledger for the daily limits.
      metadata: {
        app: appTag(),
        player_id: id,
        player_email: player.email.slice(0, 256),
      },
    });

    return json({ paymentId, amountSats }, currentTrace(), { status: 202 });
  });
}
