"use client";

import { useEffect, useState } from "react";
import { Button } from "./button";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      tone={copied ? "lime" : "ghost"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard is blocked without a secure context or permission. The
          // invoice text is selectable on screen, so this is not a dead end.
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
