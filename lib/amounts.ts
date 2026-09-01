/** Voltage denominates bitcoin in millisatoshis everywhere. */
export const MSATS_PER_SAT = 1_000;

export function satsToMsats(sats: number): number {
  return sats * MSATS_PER_SAT;
}

export function msatsToSats(msats: number): number {
  return Math.floor(msats / MSATS_PER_SAT);
}

export function formatSats(sats: number): string {
  return sats.toLocaleString("en-US");
}
