"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/**
 * Renders a QR code as inline SVG.
 *
 * SVG rather than a canvas or data URI so it stays crisp at any size, which is
 * the entire point: another phone's camera has to resolve it off this screen.
 */
export function QrCode({
  value,
  label,
  className = "",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    QRCode.toString(value, {
      type: "svg",
      margin: 0,
      // Bolt11 invoices are long, so keep correction low enough to hold the
      // module size up — a denser code is harder for a camera to resolve.
      errorCorrectionLevel: "L",
      color: { dark: "#0a0410", light: "#fff6e5" },
    })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className={`outline-chunk hard-shadow aspect-square bg-bone p-3 ${className}`}>
      {svg ? (
        <div
          role="img"
          aria-label={label}
          className="size-full [&>svg]:size-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="size-full animate-pulse bg-ink/10" />
      )}
    </div>
  );
}
