import type { FitAnalysis, SourceHealth } from "./types";
export type OpportunityKind = "subvencion" | "licitacion" | "boletin" | "europa" | "empresa";
export type NivelAdmin = "Estatal" | "Autonómica" | "Local" | "UE" | "Privada" | "Otros";
export interface OpportunityDocument { name: string; description: string; url: string; docId?: number }
export interface Opportunity {
  id: string;              // unique + stable: `${source}:${nativeId}`
  source: string;          // "bdns" | "boe" | "bocm" | "dog" | "eu" | "fb" | "rsc"
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
  firstSeenAt?: string;       // ISO; only with the Postgres store (first ingest that saw it)
  history?: History | null;   // BDNS only: previous editions and who won them (null/absent when unknown)
}
/** Previous editions of a BDNS call (newest first; the current one is not listed). Never names natural persons. */
export interface History {
  editions: HistoryEdition[];
  typicalOpening: { from: number; to: number; text: string; irregular: boolean } | null; // text: ready Spanish phrase
  typicalWindow: string | null; // "10 días hábiles"
  awards: AwardsSummary | null;
}
export interface HistoryEdition {
  year: number;
  numero: string;
  url: string;              // BDNS page of that edition
  openedAt: string | null;  // YYYY-MM-DD
  closesAt: string | null;
  window: string | null;    // "10 días hábiles"
  awards: { count: number; nonProfit: number; importe: number | null } | null; // null: not checked
}
export interface AwardsSummary {
  editions: number[];       // years the counts come from
  total: number;
  nonProfit: number;
  nonProfitShare: number;
  byClass: Record<string, number>; // sinAnimo, empresa, ayuntamiento, publico, persona, cooperativa, ...
  wonByReforesta: { year: number; importe: number | null }[];
  peers: string[];          // environmental NGOs among the winners
}
export interface OpportunitiesResponse {
  items: Opportunity[]; sources: SourceHealth[]; fetchedAt: string; cached: boolean;
  stale?: boolean;      // served from cache past its TTL (a background refresh was started)
  refreshing?: boolean; // a background refresh is running right now
  storage?: "postgres" | "cache"; // where this response came from
  lastIngestAt?: string | null;   // Postgres: finish time of the last successful ingest run
  ingestStale?: boolean;          // Postgres: last successful ingest older than 36 h (or none yet)
}
