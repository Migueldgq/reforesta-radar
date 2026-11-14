import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reforesta Radar — Detector y priorizador de convocatorias",
  description:
    "Encuentra y prioriza convocatorias públicas, boletines y programas RSC para Reforesta. Menos horas leyendo bases, más horas en el monte.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#F7F6F2] text-stone-900 font-sans">
        {children}
      </body>
    </html>
  );
}
