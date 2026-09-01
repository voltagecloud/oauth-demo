/**
 * Currency handling.
 *
 * Voltage denominates every amount in that currency's **base unit**: msats for
 * bitcoin, cents for USD. This app does the same, end to end — configuration,
 * the ledger, the policy caps — and only converts at the edge, for display.
 * Keeping one unit all the way through is what stops a USD cap being compared
 * against a bitcoin rail amount.
 */

export type WalletCurrency = "btc" | "usd";

/** What Voltage calls the unit in responses. */
export function baseUnit(currency: WalletCurrency): "msats" | "cents" {
  return currency === "usd" ? "cents" : "msats";
}

/** Renders a base-unit amount for a human. */
export function formatAmount(minor: number, currency: WalletCurrency): string {
  if (currency === "usd") {
    return (minor / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    });
  }

  // Bitcoin is configured in msats but nobody reads msats. Show sats, and only
  // spend decimals when the amount is not a whole number of them.
  const sats = minor / 1_000;
  const text = Number.isInteger(sats)
    ? sats.toLocaleString("en-US")
    : sats.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return `${text} sats`;
}

/** A compact form for meters, where the currency is already established. */
export function formatCompact(minor: number, currency: WalletCurrency): string {
  return currency === "usd"
    ? (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (minor / 1_000).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** The label a meter puts after its numbers. */
export function unitLabel(currency: WalletCurrency): string {
  return currency === "usd" ? "USD" : "sats";
}

/** Default deposit buttons, in base units. */
export function defaultPresets(currency: WalletCurrency): number[] {
  return currency === "usd"
    ? [500, 1_000, 2_500, 5_000] // $5 / $10 / $25 / $50
    : [500_000, 1_000_000, 2_500_000, 5_000_000]; // 500 / 1k / 2.5k / 5k sats
}
