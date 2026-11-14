"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlarmClock, Building2, ChevronRight, Compass, Database, DoorOpen, FileSearch, House, Info, ListChecks, Loader2, RotateCw, Sprout, Target } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_FILTERS, EMPTY_DIMS, fmtAgo, isClosed, plazoValues, type Filters } from "./model";
import { RadarProvider, useRadar } from "./store";
import { DetailDrawer } from "./Drawer";

const RADAR = [
  { href: "/", label: "Inicio", icon: House },
  { href: "/seguimiento", label: "Seguimiento", icon: ListChecks },
  { href: "/empresas", label: "Empresas", icon: Building2 },
];
const TOOLS = [
  { href: "/analizar", label: "Analizar PDF", icon: FileSearch },
  { href: "/fuentes", label: "Fuentes", icon: Database },
];
const TITLES: Record<string, string> = {
  "/": "Convocatorias",
  "/seguimiento": "Seguimiento",
  "/empresas": "Empresas y fundaciones",
  "/analizar": "Analizar PDF",
  "/fuentes": "Fuentes",
};

type QuickKey = "abierta" | "30d" | "alto" | "fuera";
const QUICK: { key: QuickKey; label: string; icon: typeof House }[] = [
  { key: "abierta", label: "Abiertas ahora", icon: DoorOpen },
  { key: "30d", label: "Cierran en 30 días", icon: AlarmClock },
  { key: "alto", label: "Encaje alto", icon: Target },
  { key: "fuera", label: "Fuera de tus 4 fuentes", icon: Compass },
];

function quickOn(f: Filters, k: QuickKey) {
  if (k === "fuera") return f.flags.includes("fuera");
  if (k === "alto") return f.dims.tier.includes("alto");
  return f.dims.plazo.includes(k);
}

const noop = () => () => {};

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  // Sidebar state persists in shadcn's `sidebar_state` cookie; read it on the client only.
  const cookieOpen = useSyncExternalStore(noop, () => !document.cookie.includes("sidebar_state=false"), () => true);
  const [open, setOpen] = useState<boolean | null>(null);
  if (path.startsWith("/landing")) return <RadarProvider>{children}</RadarProvider>;
  return (
    <RadarProvider>
      <TooltipProvider delayDuration={300}>
        <SidebarProvider open={open ?? cookieOpen} onOpenChange={setOpen}>
          <AppSidebar />
          <SidebarInset className="min-w-0">
            <Header />
            <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</main>
          </SidebarInset>
          <DetailDrawer />
        </SidebarProvider>
      </TooltipProvider>
    </RadarProvider>
  );
}

function Header() {
  const path = usePathname();
  const { refreshing } = useRadar();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 sm:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <h1 className="truncate text-sm font-medium">{TITLES[path] ?? "Reforesta Radar"}</h1>
      {refreshing && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Actualizando…
        </span>
      )}
    </header>
  );
}

function AppSidebar() {
  const path = usePathname();
  const router = useRouter();
  const { triage, data, filters, setFilters, refreshing, loading, reload } = useRadar();
  const { isMobile, setOpenMobile } = useSidebar();
  const tracking = Object.values(triage).filter((t) => t.status === "estudio" || t.status === "presentar").length;
  const busy = loading || refreshing;

  const counts = useMemo(() => {
    const c: Record<QuickKey, number> = { abierta: 0, "30d": 0, alto: 0, fuera: 0 };
    for (const o of data?.items ?? []) {
      if (isClosed(o)) continue; // match Inicio, which hides closed calls by default
      const p = plazoValues(o);
      if (p.includes("abierta")) c.abierta++;
      if (p.includes("30d")) c["30d"]++;
      if (o.fit.tier === "alto") c.alto++;
      if (o.fit.outsideManualSources) c.fuera++;
    }
    return c;
  }, [data]);

  const close = () => isMobile && setOpenMobile(false);

  const applyQuick = (k: QuickKey) => {
    const on = path === "/" && quickOn(filters, k);
    setFilters((f) => {
      const base: Filters = { ...DEFAULT_FILTERS, hideClosed: f.hideClosed, dims: EMPTY_DIMS };
      if (on) return base;
      if (k === "fuera") return { ...base, flags: ["fuera"] };
      if (k === "alto") return { ...base, dims: { ...EMPTY_DIMS, tier: ["alto"] } };
      return { ...base, dims: { ...EMPTY_DIMS, plazo: [k] } };
    });
    if (path !== "/") router.push("/");
    close();
  };

  const navItem = (n: { href: string; label: string; icon: typeof House }) => {
    const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
    return (
      <SidebarMenuItem key={n.href}>
        <SidebarMenuButton asChild isActive={active} tooltip={n.label}>
          <Link href={n.href} onClick={close} aria-current={active ? "page" : undefined}>
            <n.icon aria-hidden />
            <span>{n.label}</span>
          </Link>
        </SidebarMenuButton>
        {n.href === "/seguimiento" && tracking > 0 && <SidebarMenuBadge className="tabular-nums">{tracking}</SidebarMenuBadge>}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Reforesta Radar">
              <Link href="/" onClick={close}>
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                  <Sprout className="size-4" aria-hidden />
                </span>
                <span className="grid leading-tight">
                  <span className="font-semibold">Reforesta Radar</span>
                  <span className="text-xs text-muted-foreground">Convocatorias</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Radar</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{RADAR.map(navItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Herramientas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{TOOLS.map(navItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="w-full">
                Vistas rápidas
                <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" aria-hidden />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {QUICK.map((q) => {
                    const active = path === "/" && quickOn(filters, q.key);
                    return (
                      <SidebarMenuItem key={q.key}>
                        <SidebarMenuButton isActive={active} aria-pressed={active} tooltip={`${q.label} (${counts[q.key]})`} onClick={() => applyQuick(q.key)}>
                          <q.icon aria-hidden />
                          <span>{q.label}</span>
                        </SidebarMenuButton>
                        {data && <SidebarMenuBadge className="tabular-nums text-muted-foreground">{counts[q.key]}</SidebarMenuBadge>}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:hidden">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {busy ? "Consultando fuentes…" : data ? `Datos de ${fmtAgo(data.fetchedAt)}` : "Sin datos"}
          </p>
          <Button variant="ghost" size="icon" className="size-7" disabled={busy} onClick={() => reload(true)} aria-label="Volver a consultar las fuentes">
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
          </Button>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="sm" tooltip="Sobre el proyecto" className="text-muted-foreground">
              <Link href="/landing" onClick={close}>
                <Info aria-hidden />
                <span>Sobre el proyecto</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={data ? `Datos de ${fmtAgo(data.fetchedAt)} · actualizar` : "Actualizar"} disabled={busy} onClick={() => reload(true)}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
              <span>Actualizar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
