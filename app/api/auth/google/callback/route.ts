import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/env";
import { exchangeCode } from "@/lib/google";
import { approveHandoff, consumeHandoff, readHandoff } from "@/lib/handoff";
import { encodeSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Where Google sends the player back.
 *
 * Both devices land here, and the handoff's `mode` decides what happens next:
 *
 *   same_device  — this *is* the browser that started it, so set the cookie
 *                  and drop them back on the machine, signed in.
 *   cross_device — this is the phone. Write the identity into the handoff and
 *                  show a "go back to the big screen" page; the laptop's poll
 *                  picks it up within a second or two.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appOrigin(request);

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";

  if (error) return fail(origin, error === "access_denied" ? "cancelled" : "google_error");
  if (!code || !state) return fail(origin, "missing_code");

  // The state must resolve to a handoff this server minted and has not yet
  // completed. That is what stops a forged callback.
  const handoff = await readHandoff(state);
  if (!handoff || handoff.record.status !== "pending") return fail(origin, "expired");

  let identity;
  try {
    identity = await exchangeCode({ code, codeVerifier: handoff.record.codeVerifier, origin });
  } catch (cause) {
    console.error("Google code exchange failed", cause);
    return fail(origin, "exchange_failed");
  }

  const approved = await approveHandoff(state, identity);
  if (!approved) return fail(origin, "expired");

  if (handoff.record.mode === "cross_device") {
    return NextResponse.redirect(`${origin}/link/${encodeURIComponent(state)}?done=1`);
  }

  // Same device: nothing needs to poll, so claim it here and set the cookie.
  const player = await consumeHandoff(state);
  if (!player) return fail(origin, "expired");

  const response = NextResponse.redirect(`${origin}/`);
  response.cookies.set(
    SESSION_COOKIE,
    encodeSession(player),
    sessionCookieOptions(url.protocol === "https:"),
  );
  return response;
}

function fail(origin: string, reason: string) {
  return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(reason)}`);
}
