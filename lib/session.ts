import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authSecret } from "@/lib/env";

export const SESSION_COOKIE = "jj_player";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface Player {
  /** Google's stable subject id. The only durable key in this app. */
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  /** Unix seconds. */
  exp: number;
}

/**
 * The identifier written into every invoice's metadata, and the one the daily
 * limits are counted against. Namespaced so a second identity provider could be
 * added later without colliding.
 */
export function playerId(player: Pick<Player, "sub">): string {
  return `google:${player.sub}`;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

/**
 * A self-contained signed cookie — there is no session store.
 *
 * Nothing here needs to be secret from the holder; the signature only has to
 * stop someone editing `sub` and spending against another player's allowance.
 */
export function encodeSession(player: Omit<Player, "exp">): string {
  const body: Player = { ...player, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payload = base64url(JSON.stringify(body));
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined): Player | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const player = JSON.parse(Buffer.from(payload, "base64url").toString()) as Player;
    if (!player.sub || player.exp * 1000 < Date.now()) return null;
    return player;
  } catch {
    return null;
  }
}

export async function currentPlayer(): Promise<Player | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
