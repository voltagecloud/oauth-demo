import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/env";
import { createPkcePair } from "@/lib/google";
import { createHandoff, newHandoffId, type HandoffMode } from "@/lib/handoff";

export const dynamic = "force-dynamic";

/**
 * Opens a sign-in handoff and hands back the URL to put in the QR code.
 *
 * The PKCE verifier is generated here and kept server-side against the handoff
 * id, which is what lets the flow finish on a different device than it started
 * on: the phone has no cookie from the laptop, but it presents the handoff id
 * as the OAuth `state`, and that is enough to find the verifier again.
 */
export async function POST(request: Request) {
  const mode: HandoffMode =
    new URL(request.url).searchParams.get("mode") === "same_device" ? "same_device" : "cross_device";

  const origin = appOrigin(request);
  const id = newHandoffId();
  const { verifier, challenge } = createPkcePair();

  const record = await createHandoff({ id, mode, codeVerifier: verifier });

  return NextResponse.json({
    handoffId: id,
    // What the phone camera resolves to.
    linkUrl: `${origin}/link/${encodeURIComponent(id)}`,
    // What "continue in this browser" navigates to.
    startUrl: `${origin}/api/auth/google/start?handoff=${encodeURIComponent(id)}`,
    expiresAt: record.expiresAt,
    // Unused by the client, but it makes the PKCE step visible to anyone
    // poking at the network tab to understand the flow.
    codeChallengeMethod: "S256",
    codeChallenge: challenge,
  });
}
