import { Laptop, ShieldCheck, TriangleAlert } from "lucide-react";
import type { AssistantKind } from "@/lib/team";
import { cn } from "@/lib/utils";

const KINDS: Record<AssistantKind, { label: string; Icon: typeof Laptop; tone: string }> = {
  conocido: { label: "Claude", Icon: ShieldCheck, tone: "border-primary/25 bg-primary/5 text-primary" },
  local: { label: "En tu ordenador", Icon: Laptop, tone: "border-border bg-muted/60 text-foreground" },
  desconocido: { label: "No reconocido", Icon: TriangleAlert, tone: "border-amber-300 bg-amber-50 text-amber-950" },
};

/** Where an assistant sends its permission, as a chip: icon + plain words (never a coloured stripe). */
export function AssistantKindChip({ kind, className }: { kind: AssistantKind; className?: string }) {
  const { label, Icon, tone } = KINDS[kind];
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", tone, className)}>
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}
