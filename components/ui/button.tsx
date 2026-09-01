"use client";

import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type Tone = "banana" | "cyan" | "magenta" | "lime" | "ghost";

const TONES: Record<Tone, string> = {
  banana: "bg-banana text-ink",
  cyan: "bg-cyan text-ink",
  magenta: "bg-magenta text-bone",
  lime: "bg-lime text-ink",
  ghost: "bg-panel text-bone",
};

/**
 * A cabinet button: flat fill, thick black outline, and a hard shadow it
 * visibly sinks into when pressed. The translate-on-active is the whole
 * illusion — the shadow disappears over exactly the distance the face moves.
 */
function buttonClass(tone: Tone, className: string): string {
  return [
    "pixel-text outline-chunk hard-shadow-sm relative inline-flex items-center justify-center gap-2",
    "px-5 py-3 text-sm no-underline transition-[transform,box-shadow] duration-75",
    "active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-x-0 disabled:active:translate-y-0",
    TONES[tone],
    className,
  ].join(" ");
}

export function Button({
  tone = "banana",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button {...props} className={buttonClass(tone, className)} />;
}

/**
 * The same face, but a real link.
 *
 * Sign-in points at `/api/auth/google/start`, which is a redirect to Google
 * rather than a page in this app — so it has to be a plain navigation, not a
 * client-side route push. As an anchor it also survives middle-click and
 * "open in new tab", which a button handler would not.
 */
export function ButtonLink({
  tone = "banana",
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: Tone }) {
  return <a {...props} className={buttonClass(tone, className)} />;
}
