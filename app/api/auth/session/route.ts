import { NextResponse } from "next/server";
import { treasuryWalletId } from "@/lib/env";
import { currentPlayer } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const player = await currentPlayer();

  return NextResponse.json({
    player: player
      ? { sub: player.sub, email: player.email, name: player.name, picture: player.picture }
      : null,
    // Drives whether the autopay button renders at all.
    autopayAvailable: Boolean(treasuryWalletId()),
  });
}
