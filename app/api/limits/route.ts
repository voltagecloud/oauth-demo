import { z } from "zod";
import { apiError, handle, json } from "@/lib/api";
import { policyConfig, voltageConfig } from "@/lib/env";
import { evaluate, readUsage } from "@/lib/limits";
import { currentPlayer, playerId } from "@/lib/session";
import { currentTrace } from "@/lib/trace";
import { getWalletPolicies, summarisePolicies } from "@/lib/voltage/policies";
import { paymentSats } from "@/lib/voltage/payments";

export const dynamic = "force-dynamic";

const querySchema = z.object({ amount: z.coerce.number().int().positive().optional() });

/**
 * The player's standing with both policy layers.
 *
 * Voltage's wallet policy is fetched alongside our own counters on purpose:
 * the demo's point is that these are two different things. Voltage enforces a
 * ceiling on any single payment into this wallet, by anyone. The daily
 * per-account caps are ours, because Voltage does not know who our players are.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const player = await currentPlayer();
    if (!player) return apiError(401, "unauthenticated", "Sign in to see your limits.", {}, currentTrace());

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const probeAmount = parsed.success ? parsed.data.amount : undefined;

    const { walletId } = voltageConfig();
    const config = policyConfig();

    // Independent reads; no reason to serialise them.
    const [usage, policies] = await Promise.all([
      readUsage(playerId(player)),
      getWalletPolicies(walletId).catch(() => null),
    ]);

    return json(
      {
        usage: {
          used: usage.used,
          pending: usage.pending,
          remaining: usage.remaining,
          limits: usage.limits,
          windowStart: usage.windowStart,
          resetsAt: usage.resetsAt,
          window: config.window,
        },
        deposits: usage.payments.map((payment) => ({
          id: payment.id,
          status: payment.status,
          sats: paymentSats(payment),
          createdAt: payment.created_at,
        })),
        bounds: { minSats: config.minDepositSats, maxSats: config.maxDepositSats },
        // null when the API key lacks read access to wallet policies; the panel
        // says so rather than pretending there is no policy.
        walletPolicy: policies ? summarisePolicies(policies) : null,
        probe: probeAmount ? evaluate(usage, probeAmount) : null,
      },
      currentTrace(),
    );
  });
}
