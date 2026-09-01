import { createHash, randomUUID } from "node:crypto";

export { randomUUID };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every Voltage payment id is a UUID, so anything else is a malformed request
 * and should be rejected before it becomes an upstream call.
 *
 * This is not just hygiene. Netlify's proxy retries a 404 with static-file
 * suffixes appended (`/deposits/{id}` → `/deposits/{id}.html`), and without
 * this guard that retry reaches the handler as a *different, unknown* id — for
 * which the eventual-consistency path below would answer a cheerful "still
 * generating" instead of the 404 the original request earned.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * A deterministic UUIDv5-shaped id derived from a seed.
 *
 * Voltage takes the payment id we generate as its idempotency key, so deriving
 * it from something stable means a retry replays the same id and is rejected as
 * a duplicate rather than moving money twice.
 */
export function derivedUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const version = (Number.parseInt(hex[12] ?? "0", 16) & 0x0f) | 0x50;
  const variant = (Number.parseInt(hex[16] ?? "0", 16) & 0x03) | 0x08;
  const chars = [...hex.slice(0, 32)];
  chars[12] = version.toString(16)[0];
  chars[16] = variant.toString(16)[0];
  const s = chars.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
