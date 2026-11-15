"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlarmClock, Building2, ChevronRight, Database, DoorOpen, FileSearch, House, Info, ListChecks, Loader2, SlidersHorizontal, Sprout, Target, UsersRound, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { AccountMenu } from "@/components/auth/AccountMenu";
import { SessionGate, useSession } from "@/components/auth/session";
import { isPublicPath } from "@/lib/api";
import { DEFAULT_FILTERS, EMPTY_DIMS, fmtFreshness, matches, PLAZO_LABELS, quickFilters, quickOn, type QuickKey } from "./model";
import { RadarProvider, useRadar } from "./store";
import { DetailDrawer } from "./Drawer";
import { Notices } from "./Notices";
import { focusSearch } from "./filters";

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
/** Only for admins (the page itself also refuses members). */
const ADMIN_TOOLS = [{ href: "/equipo", label: "Equipo", icon: UsersRound }];

const QUICK: { key: QuickKey; label: string; icon: typeof House }[] = [
  { key: "abierta", label: PLAZO_LABELS.abierta, icon: DoorOpen },
  { key: "30d", label: PLAZO_LABELS["30d"], icon: AlarmClock },
  { key: "alto", label: "Encaje alto", icon: Target },
];

const noop = () => () => {};

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  // Sidebar state persists in shadcn's `sidebar_state` cookie; read it on the client only.
  const cookieOpen = useSyncExternalStore(noop, () => !document.cookie.includes("sidebar_state=false"), () => true);
  const [open, setOpen] = useState<boolean | null>(null);
  // Public pages (landing, login, links with a token) never load team data.
  if (isPublicPath(path)) return children;
  // The assistant's permission page: signed in, but on its own, without the app around it.
  if (path === "/autorizar") return <SessionGate>{children}</SessionGate>;
  return (
    <SessionGate>
      <RadarProvider>
        <TooltipProvider delayDuration={300}>
          <SidebarProvider open={open ?? cookieOpen} onOpenChange={setOpen}>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <MobileBar />
              <OfflineNotice />
              {/* SidebarInset is the page's <main>; this only sets the width. */}
              <div className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</div>
            </SidebarInset>
            <DetailDrawer />
            <Notices />
            <SearchShortcut />
          </SidebarProvider>
        </TooltipProvider>
      </RadarProvider>
    </SessionGate>
  );
}

/** The server cannot be reached: the views keep the saved copy, changes are refused, and the store keeps retrying. */
function OfflineNotice() {
  const { offline, data } = useRadar();
  if (!offline) return null;
  const when = data ? fmtFreshness(data.lastIngestAt ?? data.fetchedAt).replace(/^Datos /, "") : null;
  return (
    <div role="status" className="border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-950 sm:px-6 lg:px-10">
      <p className="mx-auto flex max-w-[1280px] items-start gap-2">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {when
            ? `No podemos conectar con el servidor. Estás viendo los datos guardados ${when}; los cambios no se guardarán.`
            : "No podemos conectar con el servidor."}{" "}
          <span className="text-amber-900/80">Lo volvemos a intentar solos cada pocos segundos.</span>
        </span>
      </p>
    </div>
  );
}

/** "/" (outside text fields) and ⌘K / Ctrl+K focus Inicio's search, going to Inicio first if needed. */
function SearchShortcut() {
  const path = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
      const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing;
      if (!cmdK && !slash) return;
      // Not while a dialog or the detail drawer is open: focus is trapped there on purpose.
      if (document.querySelector("[role=dialog], [role=alertdialog]") && !(isMobile && document.querySelector("[data-mobile=true]"))) return;
      e.preventDefault();
      if (isMobile) setOpenMobile(false);
      if (!focusSearch() && path !== "/") router.push("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, router, isMobile, setOpenMobile]);
  return null;
}

/** Mobile only: the sidebar is an off-canvas sheet there, so its trigger has to live outside it. */
function MobileBar() {
  const path = usePathname();
  const { refreshing } = useRadar();
  const item = [...TOOLS, ...ADMIN_TOOLS, ...RADAR].find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur-sm md:hidden">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      {item && (
        <span className="truncate text-sm text-muted-foreground" aria-current="page">
          {item.label}
        </span>
      )}
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
  const { board, data, filters, setFilters, markPush, loading } = useRadar();
  const { isAdmin } = useSession();
  const { isMobile, setOpenMobile } = useSidebar();
  const tracking = Object.values(board).filter((t) => t.status === "estudio" || t.status === "presentar").length;

  // Each count is the number of rows the view shows: the same filter, applied to the same calls.
  const counts = useMemo(() => {
    const c: Record<QuickKey, number> = { abierta: 0, "30d": 0, alto: 0 };
    for (const k of QUICK) {
      const f = quickFilters(filters, k.key);
      c[k.key] = (data?.items ?? []).filter((o) => matches(o, f, "nueva", "")).length;
    }
    return c;
  }, [data, filters]);

  const close = () => isMobile && setOpenMobile(false);

  const applyQuick = (k: QuickKey) => {
    const on = path === "/" && quickOn(filters, k);
    // Quick views keep the chosen organisms: that choice is a standing team preference, cleared only by hand.
    if (path === "/") markPush();
    setFilters((f) => (on ? { ...DEFAULT_FILTERS, dims: { ...EMPTY_DIMS, organismo: f.dims.organismo } } : quickFilters(f, k)));
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
    <Sidebar collapsible="icon" role="navigation" aria-label="Menú del radar">
      <SidebarHeader>
        <SidebarMenu className="flex-row items-center group-data-[collapsible=icon]:flex-col">
          <SidebarMenuItem className="min-w-0 flex-1">
            <SidebarMenuButton asChild size="lg" tooltip="Reforesta Radar">
              <Link href="/" onClick={close}>
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                  <Sprout className="size-4" aria-hidden />
                </span>
                <span className="font-semibold">Reforesta Radar</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <li className="list-none">
            <SidebarTrigger className="size-8 shrink-0 text-muted-foreground" />
          </li>
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
            <SidebarMenu>{(isAdmin ? [...TOOLS, ...ADMIN_TOOLS] : TOOLS).map(navItem)}</SidebarMenu>
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
        <p className="truncate px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          {data ? fmtFreshness(data.lastIngestAt ?? data.fetchedAt) : loading ? "Cargando…" : "Sin datos"}
        </p>
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
        <AccountMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
