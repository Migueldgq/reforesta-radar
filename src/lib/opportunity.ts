import type { FitAnalysis, SourceHealth } from "./types";
export type OpportunityKind = "subvencion" | "licitacion" | "boletin" | "europa" | "empresa";
export type NivelAdmin = "Estatal" | "Autonómica" | "Local" | "UE" | "Privada" | "Otros";
export interface OpportunityDocument { name: string; description: string; url: string; docId?: number }
export interface Opportunity {
  id: string;              // unique + stable: `${source}:${nativeId}`
  source: string;          // "bdns" | "boe" | "bocm" | "dog" | "eu" | "fb" | "rsc" | extra ids
  sourceLabel: string;     // short human label, e.g. "BDNS", "BOE", "UE · LIFE"
  kind: OpportunityKind;
  titulo: string;
  organismo: string;
  region: string;          // CCAA name ("Galicia", "Comunidad de Madrid"…), "Estatal" or "Unión Europea"
  nivelAdmin: NivelAdmin;
  publishedAt: string | null; // YYYY-MM-DD
  opensAt: string | null;     // YYYY-MM-DD
  deadline: string | null;    // YYYY-MM-DD
  deadlineText: string | null; // free text when no exact date (e.g. "20 días hábiles desde publicación")
  budget: number | null;      // euros
  amountText: string | null;  // e.g. RSC "20.000 € – 40.000 € por proyecto"
  tipo: string | null;        // e.g. "Concurrencia competitiva - canónica", "Licitación pública"
  beneficiarios: string[];
  url: string;                // official page
  basesUrl: string | null;
  documents: OpportunityDocument[];
  summary: string | null;     // 1-3 sentences: purpose / finalidad if known
  rsc?: { whyReforesta: string; pitchAngle: string; cadence: string };
  fit: FitAnalysis;           // existing type in src/lib/types.ts
}
export interface OpportunitiesResponse {
  items: Opportunity[]; sources: SourceHealth[]; fetchedAt: string; cached: boolean;
  stale?: boolean;      // served from cache past its TTL (a background refresh was started)
  refreshing?: boolean; // a background refresh is running right now
}
