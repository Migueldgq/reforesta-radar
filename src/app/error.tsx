"use client";

import { CrashScreen } from "@/components/radar/CrashScreen";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} inShell />;
}
