/**
 * A segmented allowance bar.
 *
 * Segments rather than a smooth fill because the quantity limit is genuinely
 * discrete — "4 of 7 deposits" should look like four lit blocks, not 57%. The
 * amount meter reuses it with more segments for the same visual language.
 */
export function Meter({
  label,
  used,
  pending,
  limit,
  segments,
  tone,
  /** Renders a raw value for display; identity for plain counts. */
  format = (value: number) => value.toLocaleString(),
  suffix = "",
}: {
  label: string;
  used: number;
  pending: number;
  limit: number;
  segments: number;
  tone: "banana" | "cyan";
  format?: (value: number) => string;
  suffix?: string;
}) {
  const perSegment = limit / segments;
  const usedSegments = Math.min(segments, Math.round(used / perSegment));
  const pendingSegments = Math.min(segments - usedSegments, Math.ceil(pending / perSegment));

  const fill = tone === "banana" ? "bg-banana" : "bg-cyan";
  const total = used + pending;

  return (
    <div>
      <div className="pixel-text mb-1.5 flex items-baseline justify-between text-[10px] text-bone/70">
        <span>{label}</span>
        <span className="text-bone">
          {format(total)}
          <span className="text-bone/50"> / {format(limit)}{suffix}</span>
        </span>
      </div>
      <div className="outline-chunk flex gap-[3px] bg-ink p-[3px]">
        {Array.from({ length: segments }, (_, index) => {
          const state =
            index < usedSegments ? "used" : index < usedSegments + pendingSegments ? "pending" : "free";
          return (
            <div
              key={index}
              className={[
                "h-4 flex-1",
                state === "used" ? fill : state === "pending" ? `${fill} opacity-40` : "bg-panel-2",
              ].join(" ")}
            />
          );
        })}
      </div>
      {pending > 0 ? (
        <p className="pixel-text mt-1 text-[9px] text-bone/45">
          {format(pending)}{suffix} held by unpaid invoices
        </p>
      ) : null}
    </div>
  );
}
