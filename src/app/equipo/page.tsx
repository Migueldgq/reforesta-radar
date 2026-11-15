import { Suspense } from "react";
import { EquipoView } from "@/components/radar/EquipoView";

export const metadata = { title: "Equipo · Reforesta Radar" };

export default function Page() {
  return (
    <Suspense>
      <EquipoView />
    </Suspense>
  );
}
