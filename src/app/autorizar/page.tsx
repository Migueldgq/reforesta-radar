import { Suspense } from "react";
import { ConsentView } from "@/components/auth/ConsentView";

export const metadata = { title: "Conectar un agente de IA · Reforesta Radar" };

export default function Page() {
  return (
    <Suspense>
      <ConsentView />
    </Suspense>
  );
}
