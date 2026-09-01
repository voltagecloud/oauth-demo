import { voltageConfig } from "@/lib/env";
import { record } from "@/lib/trace";

/**
 * Requests run inside a serverless function with a hard execution ceiling.
 * Every poll here must fit comfortably underneath it, so no handler ever blocks
 * waiting for a payment to settle — it hands the client an id to poll instead.
 */
export const SERVER_POLL_BUDGET_MS = 6_000;

export class VoltageError extends Error {
  constructor(
    readonly status: number,
    /** Machine-readable discriminator. Branch on this, never on `detail`. */
    readonly type: string | undefined,
    readonly code: string | undefined,
    readonly detail: string | undefined,
    readonly context?: unknown,
  ) {
    super(detail ?? `Voltage API error (HTTP ${status})`);
    this.name = "VoltageError";
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isConflict() {
    return this.status === 409;
  }
}

type QueryValue = string | number | boolean | string[] | Record<string, string> | undefined | null;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

/**
 * Serialises query parameters the way the Voltage spec declares them:
 *
 *   arrays  → `statuses[]=completed&statuses[]=receiving`
 *   objects → `metadata[player_id]=google:123`   (OpenAPI `deepObject`)
 *
 * That metadata form is what makes Voltage usable as the per-player ledger.
 */
function buildUrl(base: string, path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(`${key}[]`, entry);
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) url.searchParams.set(`${key}[${k}]`, v);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function toVoltageError(response: Response, body: unknown): Promise<VoltageError> {
  const envelope = (body as { error?: Record<string, unknown> })?.error ?? body;
  const error = (envelope ?? {}) as Record<string, unknown>;
  return new VoltageError(
    response.status,
    error.type as string | undefined,
    error.code as string | undefined,
    (error.detail ?? error.message) as string | undefined,
    error.context,
  );
}

/**
 * Issues a request against the Voltage API and records it for the debug panel.
 *
 * Mutating endpoints answer `202 Accepted` with an empty body — the resource is
 * created asynchronously and identified by the UUID *we* generated. Those calls
 * resolve to `undefined`; poll for the resource afterwards.
 */
export async function voltageRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { apiKey, baseUrl } = voltageConfig();
  const { method = "GET", body, query, signal } = options;

  const url = buildUrl(baseUrl, path, query);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal,
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    record({
      method,
      path: url.slice(baseUrl.length),
      status: 0,
      durationMs: Date.now() - startedAt,
      requestBody: body,
      error: cause instanceof Error ? cause.message : "Network error",
    });
    throw cause;
  }

  const text = await response.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body (gateway HTML, plain text). The status carries the meaning.
      parsed = text;
    }
  }

  record({
    method,
    path: url.slice(baseUrl.length),
    status: response.status,
    durationMs: Date.now() - startedAt,
    requestBody: body,
    responseBody: parsed,
  });

  if (!response.ok) throw await toVoltageError(response, parsed);
  if (response.status === 202 || response.status === 204) return undefined as T;
  return parsed as T;
}

export class PollTimeoutError extends Error {
  constructor(label: string) {
    super(`Timed out waiting for ${label}`);
    this.name = "PollTimeoutError";
  }
}

interface PollOptions {
  timeoutMs?: number;
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  label?: string;
}

/**
 * Polls until `predicate` passes.
 *
 * Voltage's read and write paths are eventually consistent, so a `GET` issued
 * right after a successful `202` can legitimately 404 for a moment. That is
 * treated as "not yet", not as an error.
 */
export async function pollUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  const {
    timeoutMs = SERVER_POLL_BUDGET_MS,
    initialIntervalMs = 300,
    maxIntervalMs = 1_200,
    label = "resource",
  } = options;

  const deadline = Date.now() + timeoutMs;
  let interval = initialIntervalMs;

  for (;;) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch (error) {
      if (!(error instanceof VoltageError && error.isNotFound)) throw error;
    }

    if (Date.now() + interval >= deadline) throw new PollTimeoutError(label);

    await new Promise((resolve) => setTimeout(resolve, interval));
    interval = Math.min(interval * 2, maxIntervalMs);
  }
}
