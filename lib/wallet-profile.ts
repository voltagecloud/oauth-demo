import { optionalCurrency, optionalNetwork, voltageConfig } from "@/lib/env";
import type { WalletCurrency } from "@/lib/money";
import { getWallet } from "@/lib/voltage/wallets";

/**
 * What the deposit wallet is, according to Voltage.
 *
 * The currency, network and line of credit are all properties of the wallet,
 * and `GET /wallets/{id}` reports every one of them — so asking an operator to
 * restate them in environment variables only creates a way for the app and the
 * wallet to disagree. When they do, nothing errors: a USD wallet read as
 * bitcoin renders $100.00 as "10 sats" and quietly skips the quote step that
 * makes its invoices work at all.
 *
 * So this is read from the API, and the environment variables are left as
 * overrides for the cases detection cannot cover.
 */
export interface WalletProfile {
  currency: WalletCurrency;
  network: string;
  lineOfCreditId?: string;
  /** Where each value came from, so the UI can show it rather than assume. */
  source: "wallet" | "env" | "mixed";
}

interface CacheEntry {
  profile: WalletProfile;
  expiresAt: number;
}

// A wallet's currency does not change. This is only re-read so a corrected
// misconfiguration takes effect without a redeploy.
const TTL_MS = 5 * 60 * 1_000;
let cache: CacheEntry | null = null;

export function clearWalletProfileCache(): void {
  cache = null;
}

export async function walletProfile(): Promise<WalletProfile> {
  if (cache && cache.expiresAt > Date.now()) return cache.profile;

  const { walletId } = voltageConfig();
  const currencyOverride = optionalCurrency();
  const networkOverride = optionalNetwork();
  const locOverride = process.env.VOLTAGE_LINE_OF_CREDIT_ID || undefined;

  let detected: Partial<WalletProfile> = {};
  try {
    const wallet = await getWallet(walletId);
    // A wallet carries one balance per currency it holds. In practice that is
    // one; if a wallet ever reports several, an explicit override is the only
    // honest way to choose, so prefer usd only when it is the sole entry.
    const currencies = new Set(wallet.balances?.map((b) => b.currency) ?? []);
    const currency: WalletCurrency | undefined =
      currencies.size === 1 && currencies.has("usd")
        ? "usd"
        : currencies.has("btc")
          ? "btc"
          : undefined;

    detected = {
      currency,
      network: wallet.network,
      lineOfCreditId: wallet.line_of_credit_id ?? undefined,
    };
  } catch (error) {
    // The key may lack wallet read scope. That is survivable *if* the operator
    // has configured the values by hand; otherwise it is fatal and saying so
    // beats guessing "btc" and mispricing everything.
    if (!currencyOverride) {
      throw new Error(
        `Could not read wallet ${walletId} to determine its currency, and VOLTAGE_CURRENCY is not set. ` +
          `Grant the API key wallet read access, or set VOLTAGE_CURRENCY explicitly. ` +
          `(${error instanceof Error ? error.message : "unknown error"})`,
      );
    }
  }

  const currency = currencyOverride ?? detected.currency;
  if (!currency) {
    throw new Error(
      `Wallet ${walletId} reported no btc or usd balance, so its currency is unknown. Set VOLTAGE_CURRENCY explicitly.`,
    );
  }

  const usedOverride = Boolean(currencyOverride || networkOverride || locOverride);
  const profile: WalletProfile = {
    currency,
    network: networkOverride ?? detected.network ?? "mainnet",
    lineOfCreditId: locOverride ?? detected.lineOfCreditId,
    source: usedOverride ? (detected.currency ? "mixed" : "env") : "wallet",
  };

  cache = { profile, expiresAt: Date.now() + TTL_MS };
  return profile;
}

/** Config a USD receive needs, with a message naming what is missing. */
export function quoteInputs(profile: WalletProfile): { lineOfCreditId: string; network: string } {
  if (!profile.lineOfCreditId) {
    throw new Error(
      "A USD wallet needs a line of credit to price its invoices, and neither the wallet " +
        "nor VOLTAGE_LINE_OF_CREDIT_ID supplied one.",
    );
  }
  return { lineOfCreditId: profile.lineOfCreditId, network: profile.network };
}
