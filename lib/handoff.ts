import { randomBytes } from "node:crypto";
import { getStore, type Store } from "@netlify/blobs";
import type { GoogleIdentity } from "@/lib/google";

/**
 * The cross-device sign-in handoff.
 *
 * A player can start sign-in on a laptop and finish it on their phone. Nothing
 * links those two browsers, so the laptop mints a handoff record, encodes its
 * URL in a QR code, and polls. Whichever device completes Google's flow writes
 * the identity into the record; the laptop's next poll reads it and *that
 * response* is what carries the session cookie back. No push channel needed.
 *
 * The handoff id is the only thing standing between a bystander and someone
 * else's session, so it is 256 bits of randomness, expires in five minutes, and
 * is consumed exactly once with a compare-and-set.
 */

const STORE_NAME = "jungle-jackpot-handoff";
const TTL_MS = 5 * 60 * 1_000;

export type HandoffStatus = "pending" | "approved" | "consumed";

/** Which device started the flow, so the callback knows where to send them. */
export type HandoffMode = "same_device" | "cross_device";

export interface HandoffRecord {
  status: HandoffStatus;
  mode: HandoffMode;
  /** PKCE verifier. Held server-side so the flow survives a device switch. */
  codeVerifier: string;
  createdAt: string;
  expiresAt: string;
  player?: GoogleIdentity;
}

function store(): Store {
  // Strong consistency: the poll's read-then-conditional-write is only correct
  // if the read reflects the latest committed value.
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

const key = (id: string) => `handoff/${id}`;

export function newHandoffId(): string {
  return randomBytes(32).toString("base64url");
}

export async function createHandoff(params: {
  id: string;
  mode: HandoffMode;
  codeVerifier: string;
}): Promise<HandoffRecord> {
  const now = Date.now();
  const record: HandoffRecord = {
    status: "pending",
    mode: params.mode,
    codeVerifier: params.codeVerifier,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  await store().setJSON(key(params.id), record, { onlyIfNew: true });
  return record;
}

export interface VersionedHandoff {
  record: HandoffRecord;
  etag?: string;
}

/** Returns null for a missing or expired record — both mean "no longer valid". */
export async function readHandoff(id: string): Promise<VersionedHandoff | null> {
  const result = await store().getWithMetadata(key(id), { type: "json" });
  if (!result) return null;

  const record = result.data as HandoffRecord;
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await store().delete(key(id)).catch(() => {});
    return null;
  }

  return { record, etag: result.etag };
}

/** Writes the identity in once Google has verified it. */
export async function approveHandoff(id: string, player: GoogleIdentity): Promise<boolean> {
  const existing = await readHandoff(id);
  if (!existing || existing.record.status !== "pending") return false;

  const { modified } = await store().setJSON(
    key(id),
    { ...existing.record, status: "approved", player } satisfies HandoffRecord,
    { onlyIfMatch: existing.etag },
  );
  return modified;
}

/**
 * Claims an approved handoff, exactly once.
 *
 * The compare-and-set is what makes a replayed poll harmless: two requests read
 * the same approved record, both try to consume it, and only one write lands.
 * The loser gets null and no session.
 */
export async function consumeHandoff(id: string): Promise<GoogleIdentity | null> {
  const existing = await readHandoff(id);
  if (!existing || existing.record.status !== "approved" || !existing.record.player) return null;

  const { modified } = await store().setJSON(
    key(id),
    { ...existing.record, status: "consumed" } satisfies HandoffRecord,
    { onlyIfMatch: existing.etag },
  );
  if (!modified) return null;

  // The identity is in the cookie now; the record has nothing left worth keeping.
  await store().delete(key(id)).catch(() => {});
  return existing.record.player;
}
