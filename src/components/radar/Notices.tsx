"use client";

import { CircleAlert, Info, X } from "lucide-react";
import { useRadar } from "./store";

/** Short messages at the bottom of the screen: saved-or-not feedback and one-off news like the first-login import. */
export function Notices() {
  const { notices, dismiss } = useRadar();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
      {/* Two live regions, always mounted, so additions are announced with the right urgency. */}
      {(["error", "info"] as const).map((tone) => (
        <div key={tone} role={tone === "error" ? "alert" : "status"} className="flex w-full flex-col items-center gap-2 sm:items-end">
          {notices
            .filter((n) => n.tone === tone)
            .map((n) => (
              <div
                key={n.id}
                className="pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-lg border bg-background px-3.5 py-3 text-sm shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
              >
                {tone === "error" ? (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                ) : (
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                )}
                <p className="min-w-0 flex-1 leading-snug">{n.text}</p>
                <button
                  type="button"
                  onClick={() => dismiss(n.id)}
                  aria-label="Cerrar aviso"
                  className="-m-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
