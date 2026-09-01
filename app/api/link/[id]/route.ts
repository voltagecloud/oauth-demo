import { NextResponse } from "next/server";
import { consumeHandoff, readHandoff } from "@/lib/handoff";
import { encodeSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The desktop's poll.
 *
 * While the handoff is pending this says so. The moment the other device
 * finishes with Google, this consumes the record and answers with a
 * `Set-Cookie` — the poll response *is* the sign-in. That is why no websocket
 * or server-sent-event channel is needed for the cross-device flow.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const existing = await readHandoff(id);
  if (!existing) {
    return NextResponse.json({ status: "expired" }, { status: 404 });
  }

  if (existing.record.status !== "approved") {
    return NextResponse.json({ status: existing.record.status });
  }

  const player = await consumeHandoff(id);
  if (!player) {
    // Another poll won the compare-and-set. It already holds the session.
    return NextResponse.json({ status: "consumed" }, { status: 409 });
  }

  const response = NextResponse.json({
    status: "approved",
    player: { sub: player.sub, email: player.email, name: player.name, picture: player.picture },
  });

  response.cookies.set(
    SESSION_COOKIE,
    encodeSession(player),
    sessionCookieOptions(new URL(request.url).protocol === "https:"),
  );

  return response;
}
