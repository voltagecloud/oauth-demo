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

function toErrorResponse(error: unknown, trace: TraceEntry[]): NextResponse {
  if (error instanceof VoltageError) {
    console.error("Voltage API error", error.status, error.type, error.detail);
    return apiError(
      error.status >= 500 ? 502 : error.status,
      error.type ?? "voltage_error",
      error.detail ?? "The Voltage API rejected that request.",
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
