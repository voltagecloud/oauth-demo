import { NextResponse } from "next/server";
import { currentTrace, withTrace, type TraceEntry } from "@/lib/trace";
import { VoltageError } from "@/lib/voltage/client";

/**
 * Every JSON response carries the Voltage calls that produced it, so the
 * on-screen DEBUG MENU can show the real integration rather than a narration
 * of it. The API key is never in the trace — it lives in a header the tracer
 * does not record.
 */
export function json<T extends object>(body: T, trace: TraceEntry[], init?: ResponseInit) {
  return NextResponse.json({ ...body, _trace: trace }, init);
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  trace: TraceEntry[] = [],
) {
  return NextResponse.json({ error: { code, message, ...extra }, _trace: trace }, { status });
}

/**
 * Voltage answers `missing_credentials` in the one case nobody guesses: a key
 * issued for one host presented to the other. A staging key against production
 * is not a 401 — it is a 400 saying the credential is missing, because as far
 * as production is concerned that key does not exist. Worth spelling out.
 */
function explain(error: VoltageError): string {
  if (error.type === "missing_credentials") {
    return (
      "Voltage rejected the API key. The usual cause is a key issued for the other " +
      "host: a staging key must be used with VOLTAGE_API_BASE=https://staging.voltageapi.com/v1, " +
      "and a production key with the default base URL. Also check the key has not been " +
      "pasted with surrounding whitespace or quotes."
    );
  }
  return error.detail ?? "The Voltage API rejected that request.";
}

function toErrorResponse(error: unknown, trace: TraceEntry[]): NextResponse {
  if (error instanceof VoltageError) {
    console.error("Voltage API error", error.status, error.type, error.detail);
    return apiError(
      error.status >= 500 ? 502 : error.status,
      error.type ?? "voltage_error",
      explain(error),
      {},
      trace,
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error("Unhandled route error", error);
  // Missing configuration is the overwhelmingly common cause in a demo, and
  // saying so beats a generic 500 that sends people reading server logs.
  const isConfig = message.startsWith("Missing required environment variable");
  return apiError(isConfig ? 503 : 500, isConfig ? "not_configured" : "internal_error", message, {}, trace);
}

/**
 * Runs a handler with tracing on, turning anything it throws into a JSON error
 * that still carries the trace — a failed Voltage call is the most interesting
 * thing the debug panel can show. The catch sits *inside* the async-local
 * context, which is the only place the trace is still readable.
 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  const { result } = await withTrace(async () => {
    try {
      return await fn();
    } catch (error) {
      return toErrorResponse(error, currentTrace());
    }
  });
  return result;
}
