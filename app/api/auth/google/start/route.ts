import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/env";
import { authorizeUrl, challengeFromVerifier, createPkcePair } from "@/lib/google";
import { createHandoff, newHandoffId, readHandoff } from "@/lib/handoff";

export const dynamic = "force-dynamic";

/**
 * Sends the browser to Google.
 *
 * `state` is the handoff id — an unguessable 256-bit token that only exists
 * because this server minted it — so it does double duty as CSRF protection:
 * a callback whose state does not resolve to a live record is rejected.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appOrigin(request);

  let handoffId = url.searchParams.get("handoff") ?? "";
  let codeChallenge: string;

  const existing = handoffId ? await readHandoff(handoffId) : null;

  if (existing) {
    codeChallenge = challengeFromVerifier(existing.record.codeVerifier);
  } else {
    // Someone hit this route directly, or the handoff lapsed. Start a fresh
    // same-device flow rather than dead-ending them on an error page.
    const pair = createPkcePair();
    handoffId = newHandoffId();
    await createHandoff({ id: handoffId, mode: "same_device", codeVerifier: pair.verifier });
    codeChallenge = pair.challenge;
  }

  return NextResponse.redirect(authorizeUrl({ origin, state: handoffId, codeChallenge }));
}
