"use client";

import { House, RotateCw, Sprout } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { hardNavigate } from "@/lib/api";

/** What `error.tsx` and `global-error.tsx` show instead of Next's default (English) error page. */
export function CrashScreen({ error, retry, inShell = false }: { error: unknown; retry: () => void; inShell?: boolean }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className={inShell ? "grid min-h-[60svh] place-items-center py-10" : "grid min-h-svh place-items-center bg-background px-4 py-10 text-foreground"}>
      <div role="alert" className="flex max-w-md flex-col items-center gap-5 text-center">
        <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sprout className="size-5" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Algo ha fallado en esta pantalla</h1>
          <p className="text-sm text-muted-foreground">
            No es culpa tuya y lo que ya estaba guardado sigue guardado. Vuelve a intentarlo; si se repite, avisad a quien mantiene el radar.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()}>
            <RotateCw aria-hidden /> Volver a intentar
          </Button>
          {/* A full page load on purpose: it starts the app from scratch, away from whatever broke. */}
          <Button variant="outline" onClick={() => hardNavigate("/")}>
            <House aria-hidden /> Ir a Inicio
          </Button>
        </div>
      </div>
    </div>
  );
}
