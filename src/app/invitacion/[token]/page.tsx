import type { Metadata } from "next";
import { InvitationView } from "@/components/auth/AuthViews";

// The token is in the path: never send it on as a Referer (next.config.ts also sets the header).
export const metadata: Metadata = { title: "Crear tu cuenta · Reforesta Radar", referrer: "no-referrer", robots: { index: false } };

export default function Page() {
  return <InvitationView />;
}
