"use client";

import { useEffect, useRef, useState } from "react";
import type { TraceEntry } from "@/lib/trace";

/**
 * The DEBUG MENU — every Voltage HTTP call this session has made.
 *
 * This is the reason the demo exists. Someone evaluating the Voltage API is
 * going to build their own frontend, so what they need is not a pretty casino:
 * it is to watch `POST /payments` go out with the metadata attached, and then
 * watch `GET /payments?metadata[player_id]=…` come back and be the ledger.
 *
 * Routes return their trace alongside their payload and the client funnels it
 * here. The API key is never in it — the tracer records the URL and bodies, and
 * the key travels in a header it does not touch.
 */

const STATUS_TONE = (status: number) => {
  if (status === 0) return "text-blood";
  if (status >= 500) return "text-blood";
  if (status >= 400) return "text-tangerine";
  if (status === 202) return "text-banana";
  return "text-lime";
};

function Row({ entry, index }: { entry: TraceEntry; index: number }) {
  const [open, setOpen] = useState(false);
  const hasBody = entry.requestBody !== undefined || entry.responseBody !== undefined;

  // The query string carries the whole story for the ledger read, so it is
  // shown on its own line rather than truncated into the path.
  const [path, query] = entry.path.split("?");

  return (
    <li className="border-b border-bone/10 last:border-b-0">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={!hasBody}
        className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-bone/5 disabled:hover:bg-transparent"
      >
        <span className="text-bone/30 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        <span className="w-12 shrink-0 text-cyan">{entry.method}</span>
        <span className={`w-9 shrink-0 tabular-nums ${STATUS_TONE(entry.status)}`}>
          {entry.status || "ERR"}
        </span>
        <span className="min-w-0 flex-1 break-all text-bone/80">
          {path}
          {query ? (
            <span className="block text-bone/45">
              ?{decodeURIComponent(query).split("&").join("\n&")}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-bone/30 tabular-nums">{entry.durationMs}ms</span>
      </button>

      {open && hasBody ? (
        <div className="space-y-2 border-t border-bone/10 bg-ink/60 px-3 py-2">
          {entry.requestBody !== undefined ? (
            <div>
              <p className="text-bone/40">request</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-banana/90">
                {JSON.stringify(entry.requestBody, null, 2)}
              </pre>
            </div>
          ) : null}
          {entry.responseBody !== undefined ? (
            <div>
              <p className="text-bone/40">response</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-cyan/90">
                {JSON.stringify(entry.responseBody, null, 2)}
              </pre>
            </div>
          ) : null}
          {entry.error ? <p className="text-blood">{entry.error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function DebugMenu({ entries, onClear }: { entries: TraceEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const previousCount = useRef(entries.length);

  // Scroll new calls into view only when the panel is already open, so it never
  // yanks the page around behind the player's back.
  useEffect(() => {
    if (open && entries.length > previousCount.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
    previousCount.current = entries.length;
  }, [entries.length, open]);

  // Collapsed, this is a corner tab rather than a full-width bar: a fixed strip
  // across the bottom sits on top of whatever happens to be at the foot of the
  // viewport, and swallows clicks meant for it.
  return (
    <div className={`fixed bottom-0 z-40 ${open ? "inset-x-0" : "right-0"}`}>
      <div className={`px-3 pb-3 ${open ? "mx-auto max-w-5xl" : ""}`}>
        <div className="outline-chunk hard-shadow-sm bg-deep">
          <div className={`flex items-center gap-2 bg-grape px-3 py-1.5 ${open ? "border-b-4 border-ink" : ""}`}>
            <button
              onClick={() => setOpen((value) => !value)}
              className="pixel-text flex flex-1 items-center gap-2 text-left text-[11px] text-bone"
              aria-expanded={open}
            >
              <span aria-hidden>{open ? "▼" : "▲"}</span>
              Debug menu
              <span className="text-bone/60">
                {entries.length} Voltage {entries.length === 1 ? "call" : "calls"}
              </span>
            </button>
            {entries.length > 0 && open ? (
              <button
                onClick={onClear}
                className="pixel-text text-[10px] text-bone/60 hover:text-bone"
              >
                Clear
              </button>
            ) : null}
          </div>

          {open ? (
            entries.length === 0 ? (
              <p className="px-3 py-4 font-mono text-[11px] text-bone/45">
                No API calls yet. Sign in and open the cashier — every request this app
                makes to voltageapi.com shows up here, verbatim.
              </p>
            ) : (
              <ol ref={listRef} className="max-h-[46vh] overflow-y-auto font-mono text-[11px]">
                {entries.map((entry, index) => (
                  <Row key={`${index}-${entry.path}-${entry.durationMs}`} entry={entry} index={index} />
                ))}
              </ol>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
