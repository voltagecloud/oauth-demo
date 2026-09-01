import type { ReactNode } from "react";

/** A console UI plate: flat panel, chunky outline, hard shadow, optional label tab. */
export function Panel({
  label,
  tone = "cyan",
  children,
  className = "",
}: {
  label?: string;
  tone?: "cyan" | "banana" | "magenta" | "lime" | "grape";
  children: ReactNode;
  className?: string;
}) {
  const tabTone = {
    cyan: "bg-cyan text-ink",
    banana: "bg-banana text-ink",
    magenta: "bg-magenta text-bone",
    lime: "bg-lime text-ink",
    grape: "bg-grape text-bone",
  }[tone];

  return (
    <section className={`outline-chunk hard-shadow relative bg-panel ${className}`}>
      {label ? (
        <div className={`pixel-text border-b-4 border-ink px-3 py-1.5 text-[11px] ${tabTone}`}>
          {label}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
