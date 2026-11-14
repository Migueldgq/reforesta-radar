"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Database, FileSearch, House, ListChecks, Sprout } from "lucide-react";
import type { ReactNode } from "react";
import { RadarProvider, useRadar } from "./store";
import { DetailDrawer } from "./Drawer";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Inicio", short: "Inicio", icon: House },
  { href: "/seguimiento", label: "Seguimiento", short: "Seguimiento", icon: ListChecks },
  { href: "/empresas", label: "Empresas", short: "Empresas", icon: Building2 },
  { href: "/analizar", label: "Analizar PDF", short: "PDF", icon: FileSearch },
  { href: "/fuentes", label: "Fuentes", short: "Fuentes", icon: Database },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RadarProvider>
      <Header />
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-5 pb-28 sm:px-6 sm:pt-8 sm:pb-16 lg:px-8">{children}</main>
      <TabBar />
      <DetailDrawer />
    </RadarProvider>
  );
}

function Header() {
  const path = usePathname();
  const { triage } = useRadar();
  const tracking = Object.values(triage).filter((t) => t.status === "estudio" || t.status === "presentar").length;

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-[calc(var(--header-h)-1px)] max-w-[1280px] items-center gap-8 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-800 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
            <Sprout className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-stone-900">
            Reforesta <span className="font-normal text-stone-500">Radar</span>
          </span>
        </Link>
        <nav aria-label="Secciones" className="hidden sm:block">
          <ul className="flex gap-1">
            {NAV.map((n) => {
              const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={on ? "page" : undefined}
                    className={cx(
                      "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
                      on ? "bg-white font-medium text-stone-900 shadow-sm ring-1 ring-stone-200" : "text-stone-600 hover:bg-stone-200/50 hover:text-stone-900",
                    )}
                  >
                    {n.label}
                    {n.href === "/seguimiento" && tracking > 0 && (
                      <span className="rounded-full bg-brand-800 px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular-nums">{tracking}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}

/* Mobile: all five sections always visible in a bottom tab bar. */
function TabBar() {
  const path = usePathname();
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
    >
      <ul className="grid grid-cols-5">
        {NAV.map((n) => {
          const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={cx("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]", on ? "font-medium text-brand-800" : "text-stone-500")}
              >
                <n.icon className="h-5 w-5" strokeWidth={on ? 2.25 : 1.75} aria-hidden />
                {n.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
