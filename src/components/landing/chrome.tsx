import fs from "node:fs";
import path from "node:path";
import { Suspense, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const REPO_URL = "https://github.com/Migueldgq/reforesta-radar";

export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={cn("size-4", className)}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground", className)}>
      <Sprout className="size-4" aria-hidden />
    </span>
  );
}

const NAV = [
  { href: "#problema", label: "El problema" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#funciones", label: "Funciones" },
  { href: "#datos", label: "Datos" },
];

export function LandingNav() {
  return (
    <header className="lp-nav sticky top-0 z-40 bg-background/90 backdrop-blur-sm supports-[backdrop-filter]:bg-background/75">
      <nav aria-label="Principal" className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="#top" aria-label="Reforesta Radar, volver arriba" className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <LogoMark />
          Reforesta Radar
        </a>
        <ul className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <li key={n.href}>
              <a
                href={n.href}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {n.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Button asChild variant="ghost" size="icon-sm" className="hidden sm:inline-flex">
            <a href={REPO_URL} aria-label="Código en GitHub">
              <GithubMark />
            </a>
          </Button>
          <Button asChild size="sm">
            <Link href="/">
              Abrir el radar
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm font-medium text-primary", className)}>{children}</p>;
}

export function Section({
  id,
  className,
  children,
  label,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <section id={id} aria-labelledby={label} className={cn("mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28", className)}>
      {children}
    </section>
  );
}

/**
 * Slot for a real app screenshot. Shows `/landing/app.png` once it exists in `public/`,
 * and the live mini-preview passed as children until then.
 */
export function AppScreenshot({ children, alt }: { children: ReactNode; alt: string }) {
  return (
    <Suspense fallback={children}>
      <Screenshot alt={alt}>{children}</Screenshot>
    </Suspense>
  );
}

async function Screenshot({ children, alt }: { children: ReactNode; alt: string }) {
  await connection();
  const file = path.join(process.cwd(), "public", "landing", "app.png");
  if (!fs.existsSync(file)) return <>{children}</>;
  return (
    <Image
      src="/landing/app.png"
      alt={alt}
      width={2880}
      height={1800}
      priority
      className="h-auto w-full rounded-xl border shadow-sm"
    />
  );
}
