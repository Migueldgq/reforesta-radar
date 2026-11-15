import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/radar/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reforesta Radar",
  description:
    "Encuentra y prioriza convocatorias públicas, boletines y programas RSC para Reforesta. Menos horas leyendo bases, más horas en el monte.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        {/* The shell reads the pathname; on the token routes (/invitacion/[token], /restablecer/[token]) that is
            request data, which cacheComponents wants behind a boundary. Static routes still prerender whole. */}
        <Suspense>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
