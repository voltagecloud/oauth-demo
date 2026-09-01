import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One Voltage HTTP call, as shown in the on-screen DEBUG MENU.
 *
 * The panel is the point of this demo: someone should be able to reconstruct
 * the whole integration from the tape without reading the source. So the trace
 * carries the real method, path, query and bodies — with the API key stripped.
 */
export interface TraceEntry {
  method: string;
  /** Path and query only. The base URL is constant and just noise on screen. */
  path: string;
  status: number;
  durationMs: number;
  requestBody?: unknown;
  responseBody?: unknown;
  error?: string;
}

const storage = new AsyncLocalStorage<TraceEntry[]>();

/** Collects every Voltage call made inside `fn`. */
export async function withTrace<T>(fn: () => Promise<T>): Promise<{ result: T; trace: TraceEntry[] }> {
  const entries: TraceEntry[] = [];
  const result = await storage.run(entries, fn);
  return { result, trace: entries };
}

export function record(entry: TraceEntry): void {
  storage.getStore()?.push(entry);
}

/** The trace collected so far, even if `fn` threw partway through. */
export function currentTrace(): TraceEntry[] {
  return storage.getStore() ?? [];
}
