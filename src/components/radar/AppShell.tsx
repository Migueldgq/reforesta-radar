"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlarmClock, Building2, ChevronRight, Database, DoorOpen, FileSearch, House, Info, ListChecks, Loader2, RotateCw, SlidersHorizontal, Sprout, Target } from "lucide-react";
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
  { href: "/perfil", label: "Perfil", icon: SlidersHorizontal },
];

type QuickKey = "abierta" | "30d" | "alto";
const QUICK: { key: QuickKey; label: string; icon: typeof House }[] = [
  { key: "abierta", label: "Abiertas ahora", icon: DoorOpen },
  { key: "30d", label: "Cierran en 30 días", icon: AlarmClock },
  { key: "alto", label: "Encaje alto", icon: Target },
];

function quickOn(f: Filters, k: QuickKey) {
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
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur-sm sm:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <Crumb path={path} />
      {refreshing && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Actualizando…
        </span>
      )}
    </header>
  );
}

/** Quiet "Section / Page" label; the page's own h1 carries the title. */
function Crumb({ path }: { path: string }) {
  const tool = TOOLS.find((n) => path.startsWith(n.href));
  const item = tool ?? RADAR.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));
  if (!item) return null;
  return (
    <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <span>{tool ? "Herramientas" : "Radar"}</span>
      <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
      <span className="truncate" aria-current="page">
        {item.label}
      </span>
    </nav>
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
    const c: Record<QuickKey, number> = { abierta: 0, "30d": 0, alto: 0 };
    for (const o of data?.items ?? []) {
      // High fit counts every deadline state (closed recurring grants are next-edition leads), like Inicio's card.
      if (o.fit.tier === "alto") c.alto++;
      if (isClosed(o)) continue; // match Inicio, which hides closed calls by default
      const p = plazoValues(o);
      if (p.includes("abierta")) c.abierta++;
      if (p.includes("30d")) c["30d"]++;
    }
    return c;
  }, [data]);

  const close = () => isMobile && setOpenMobile(false);

  const applyQuick = (k: QuickKey) => {
    const on = path === "/" && quickOn(filters, k);
    setFilters((f) => {
      // Quick views keep the chosen organisms: that choice is a standing preference, cleared only by "Limpiar".
      const dims = { ...EMPTY_DIMS, organismo: f.dims.organismo };
      const base: Filters = { ...DEFAULT_FILTERS, hideClosed: f.hideClosed, dims };
      if (on) return k === "alto" ? { ...base, hideClosed: true } : base;
      if (k === "alto") return { ...base, hideClosed: false, dims: { ...dims, tier: ["alto"] } };
      return { ...base, dims: { ...dims, plazo: [k] } };
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
            {busy ? "Cargando…" : data ? `Datos de ${fmtAgo(data.lastIngestAt ?? data.fetchedAt)}` : "Sin datos"}
          </p>
          <Button variant="ghost" size="icon" className="size-7" disabled={busy} onClick={() => reload()} aria-label="Volver a cargar los datos">
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
            <SidebarMenuButton tooltip={data ? `Datos de ${fmtAgo(data.lastIngestAt ?? data.fetchedAt)} · volver a cargar` : "Volver a cargar"} disabled={busy} onClick={() => reload()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
              <span>Volver a cargar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
