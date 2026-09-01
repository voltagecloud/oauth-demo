import { optionalCurrency, optionalNetwork, voltageConfig } from "@/lib/env";
import type { WalletCurrency } from "@/lib/money";
import { getLineOfCredit } from "@/lib/voltage/lines-of-credit";
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
 *
 * The currency comes from the wallet's **line of credit**, which carries a
 * required `currency` from the moment it is created. The wallet's own
 * `balances` array is only a fallback: it is empty on a wallet nothing has
 * been paid into yet, which is exactly the state a fresh demo wallet is in.
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
const cache = new Map<string, CacheEntry>();

export function clearWalletProfileCache(): void {
  cache.clear();
}

function asCurrency(value: string | undefined): WalletCurrency | undefined {
  const lower = value?.toLowerCase();
  return lower === "usd" || lower === "btc" ? lower : undefined;
}

/**
 * Profiles a wallet. Defaults to the deposit wallet.
 *
 * The treasury wallet used by the autopay helper is profiled separately: it can
 * be denominated differently from the wallet receiving deposits, and a USD
 * wallet has to quote its *sends* as well as its receives.
 */
export async function walletProfile(walletIdOverride?: string): Promise<WalletProfile> {
  const walletId = walletIdOverride ?? voltageConfig().walletId;

  const hit = cache.get(walletId);
  if (hit && hit.expiresAt > Date.now()) return hit.profile;

  // The env overrides describe the deposit wallet only; another wallet has to
  // be taken as it is.
  const isDepositWallet = walletId === voltageConfig().walletId;
  const currencyOverride = isDepositWallet ? optionalCurrency() : undefined;
  const networkOverride = isDepositWallet ? optionalNetwork() : undefined;
  const locOverride = isDepositWallet
    ? process.env.VOLTAGE_LINE_OF_CREDIT_ID || undefined
    : undefined;

  let detected: Partial<WalletProfile> = {};
  try {
    const wallet = await getWallet(walletId);
    const lineOfCreditId = wallet.line_of_credit_id ?? undefined;

    detected = { network: wallet.network, lineOfCreditId };

    // Preferred: the line of credit. Its currency is required and present from
    // creation, so this works on a wallet that has never been paid into.
    if (lineOfCreditId) {
      const line = await getLineOfCredit(lineOfCreditId);
      detected.currency = asCurrency(line.currency);
    }

    // Fallback for a wallet with no line of credit. `balances` is empty until
    // money has moved, so this can legitimately find nothing.
    if (!detected.currency) {
      const currencies = new Set(wallet.balances?.map((b) => b.currency) ?? []);
      detected.currency = currencies.has("usd") && !currencies.has("btc") ? "usd" : currencies.has("btc") ? "btc" : undefined;
    }
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
      `Could not determine the currency of wallet ${walletId}: it has no line of credit ` +
        `and no balances to infer from. Set VOLTAGE_CURRENCY to "btc" or "usd".`,
    );
  }

  const usedOverride = Boolean(currencyOverride || networkOverride || locOverride);
  const profile: WalletProfile = {
    currency,
    network: networkOverride ?? detected.network ?? "mainnet",
    lineOfCreditId: locOverride ?? detected.lineOfCreditId,
    source: usedOverride ? (detected.currency ? "mixed" : "env") : "wallet",
  };

  cache.set(walletId, { profile, expiresAt: Date.now() + TTL_MS });
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
