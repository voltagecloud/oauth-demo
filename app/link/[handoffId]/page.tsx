import { notFound } from "next/navigation";
import { readHandoff } from "@/lib/handoff";
import { LinkScreen } from "./link-screen";

export const dynamic = "force-dynamic";

/**
 * What the phone lands on after scanning the QR code.
 *
 * The handoff is read server-side so an expired or already-used link says so
 * immediately, rather than bouncing the player to Google and failing there.
 */
export default async function LinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ handoffId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { handoffId } = await params;
  const { done } = await searchParams;

  // After the callback redirects back here the record is approved and waiting
  // for the desktop to claim it, so "done" is the success state, not an error.
  if (done) return <LinkScreen state="done" handoffId={handoffId} />;

  const handoff = await readHandoff(handoffId);
  if (!handoff) return <LinkScreen state="expired" handoffId={handoffId} />;
  if (handoff.record.status !== "pending") return <LinkScreen state="done" handoffId={handoffId} />;
  if (!handoffId) notFound();

  return <LinkScreen state="ready" handoffId={handoffId} />;
}
