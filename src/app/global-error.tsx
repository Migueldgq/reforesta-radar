"use client";

import "./globals.css";
import { CrashScreen } from "@/components/radar/CrashScreen";

/** Crashes in the root layout (the app shell, the detail drawer): it replaces the whole document. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="es">
      <body className="min-h-full font-sans antialiased">
        <title>Algo ha fallado · Reforesta Radar</title>
        <CrashScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
