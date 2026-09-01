import { Suspense } from "react";
import { GameShell } from "@/components/game-shell";

export const dynamic = "force-dynamic";

export default function Page() {
  // GameShell reads the OAuth callback's `?auth_error=` via useSearchParams,
  // which needs a boundary to suspend against during prerender.
  return (
    <Suspense fallback={null}>
      <GameShell />
    </Suspense>
  );
}
