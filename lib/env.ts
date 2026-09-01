/**
 * Environment configuration.
 *
 * Read lazily, as functions rather than module-level constants, so a missing
 * variable fails the one request that needs it with a clear message instead of
 * crashing the build or every route at import time.
 */

import type { WalletCurrency } from "@/lib/money";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer, got: ${raw}`);
  }
  return parsed;
}

export function voltageConfig() {
  return {
    apiKey: required("VOLTAGE_API_KEY"),
    organizationId: required("VOLTAGE_ORGANIZATION_ID"),
    environmentId: required("VOLTAGE_ENVIRONMENT_ID"),
    walletId: required("VOLTAGE_WALLET_ID"),
    baseUrl: optional("VOLTAGE_API_BASE") ?? "https://voltageapi.com/v1",
  };
}

/**
 * An explicit currency override.
 *
 * Normally the wallet is asked (see lib/wallet-profile.ts) — this exists for
 * deployments whose API key cannot read wallets, and there is deliberately no
 * default. Defaulting to "btc" is what turns a USD wallet into "10 sats"
 * instead of "$100.00", silently and with no error anywhere.
 */
export function optionalCurrency(): WalletCurrency | undefined {
  const raw = process.env.VOLTAGE_CURRENCY;
  if (!raw) return undefined;
  if (raw !== "btc" && raw !== "usd") {
    throw new Error(`VOLTAGE_CURRENCY must be "btc" or "usd", got: ${raw}`);
  }
  return raw;
}

const NETWORKS = ["mainnet", "testnet", "signet", "mutinynet", "none"];

export function optionalNetwork(): string | undefined {
  const raw = process.env.VOLTAGE_NETWORK;
  if (!raw) return undefined;
  if (!NETWORKS.includes(raw)) {
    throw new Error(`VOLTAGE_NETWORK must be one of ${NETWORKS.join(", ")}, got: ${raw}`);
  }
  return raw;
}

/** Present only when the autopay demo helper is configured. */
export function treasuryWalletId(): string | undefined {
  return optional("VOLTAGE_TREASURY_WALLET_ID");
}

export function googleConfig() {
  return {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
  };
}

export function authSecret(): string {
  return required("AUTH_SECRET");
}

export type LimitWindow = "utc_day" | "rolling";

/** Like `integer`, but with no default — an unset limit must not be guessed. */
function requiredInteger(name: string): number {
  const parsed = Number.parseInt(required(name), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

/**
 * The deposit policy. All amounts are in the wallet currency's base unit —
 * cents for USD, msats for bitcoin — matching what the Voltage API itself
 * takes and returns.
 *
 * The two caps are deliberately **required**. They are the entire point of the
 * demo, and a default that silently stands in for missing configuration is
 * indistinguishable from a real policy on screen: you end up debugging the
 * wrong system. Better to refuse to serve than to invent a number.
 */
export function policyConfig(currency: WalletCurrency) {
  const raw = process.env.LIMIT_WINDOW ?? "utc_day";
  if (raw !== "utc_day" && raw !== "rolling") {
    throw new Error(`LIMIT_WINDOW must be "utc_day" or "rolling", got: ${raw}`);
  }

  const [fallbackMin, fallbackMax] =
    currency === "usd" ? [100, 5_000] : [100_000, 5_000_000];

  return {
    maxDepositsPerDay: requiredInteger("LIMIT_DEPOSITS_PER_DAY"),
    maxAmountPerDay: requiredInteger("LIMIT_AMOUNT_PER_DAY"),
    window: raw as LimitWindow,
    minDeposit: integer("MIN_DEPOSIT_AMOUNT", fallbackMin),
    maxDeposit: integer("MAX_DEPOSIT_AMOUNT", fallbackMax),
    invoiceExpirySeconds: integer("INVOICE_EXPIRY_SECONDS", 900),
  };
}

/** Scopes the ledger query so one Voltage environment can host several demos. */
export function appTag(): string {
  return process.env.APP_TAG ?? "jungle-jackpot";
}

/**
 * The absolute origin this deployment is reachable at.
 *
 * Derived from the request so the same build works on localhost, a deploy
 * preview and production. APP_ORIGIN overrides it for proxies that mangle the
 * forwarded host.
 */
export function appOrigin(request: Request): string {
  const override = optional("APP_ORIGIN");
  if (override) return override.replace(/\/$/, "");

  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return new URL(request.url).origin;

  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
