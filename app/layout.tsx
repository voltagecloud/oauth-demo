import type { Metadata, Viewport } from "next";
import { Bungee, Outfit, Silkscreen } from "next/font/google";
import "./globals.css";

/**
 * Bungee is the closest free face to a 90s arcade marquee — heavy, condensed,
 * built for all-caps display. Silkscreen is a true bitmap face and carries the
 * HUD numerals. Outfit stays out of the way for anything you actually read.
 */
const display = Bungee({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const pixel = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-pixel" });
const body = Outfit({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Jungle Jackpot — OAuth deposit limits on the Voltage API",
  description:
    "A demo casino that makes players sign in with Google before depositing sats, then holds them to a daily deposit policy enforced against the Voltage Payments API.",
};

export const viewport: Viewport = {
  themeColor: "#12071f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${pixel.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
