/**
 * Environment configuration.
 *
 * Read lazily, as functions rather than module-level constants, so a missing
 * variable fails the one request that needs it with a clear message instead of
 * crashing the build or every route at import time.
 */

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

export function policyConfig() {
  const raw = process.env.LIMIT_WINDOW ?? "utc_day";
  if (raw !== "utc_day" && raw !== "rolling") {
    throw new Error(`LIMIT_WINDOW must be "utc_day" or "rolling", got: ${raw}`);
  }
  return {
    maxDepositsPerDay: integer("LIMIT_DEPOSITS_PER_DAY", 7),
    maxSatsPerDay: integer("LIMIT_SATS_PER_DAY", 10_000),
    window: raw as LimitWindow,
    minDepositSats: integer("MIN_DEPOSIT_SATS", 100),
    maxDepositSats: integer("MAX_DEPOSIT_SATS", 5_000),
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
