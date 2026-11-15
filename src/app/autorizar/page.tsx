import { Suspense } from "react";
import { ConsentView } from "@/components/auth/ConsentView";

export const metadata = { title: "Conectar un asistente · Reforesta Radar" };

export default function Page() {
  return (
    <Suspense>
      <ConsentView />
    </Suspense>
  );
}
