export type WorkLine =
  | "restauracion"
  | "conservacion"
  | "educacion"
  | "agroambiental";

export type TriageStatus = "nueva" | "estudio" | "presentar" | "descartada";

export interface BDNSRawSearchItem {
  id: number;
  mrr: boolean;
  numeroConvocatoria: string;
  descripcion: string;
  descripcionLeng: string | null;
  fechaRecepcion: string;
  nivel1: string;
  nivel2: string | null;
  nivel3: string | null;
  codigoInvente: string | null;
}

export interface BDNSDocument {
  id: number;
  descripcion: string;
  nombreFic: string;
  long: number;
  datMod: string;
  datPublicacion: string;
}

export interface BDNSDetailResponse {
  id: number;
  organo: {
    nivel1: string;
    nivel2: string | null;
    nivel3: string | null;
  };
  sedeElectronica: string | null;
  codigoBDNS: string;
  fechaRecepcion: string;
  instrumentos: { descripcion: string }[];
  tipoConvocatoria: string | null;
  presupuestoTotal: number | null;
  mrr: boolean;
  descripcion: string;
  descripcionLeng: string | null;
  tiposBeneficiarios: { descripcion: string }[];
  sectores: { descripcion: string; codigo: string }[];
  regiones: { descripcion: string }[];
  descripcionFinalidad: string | null;
  descripcionBasesReguladoras: string | null;
  urlBasesReguladoras: string | null;
  sePublicaDiarioOficial: boolean;
  abierto: boolean;
  fechaInicioSolicitud: string | null;
  fechaFinSolicitud: string | null;
  textInicio: string | null;
  textFin: string | null;
  documentos: BDNSDocument[];
}

export interface FitAnalysis {
  score: number; // 0 - 100
  tier: "alto" | "medio" | "bajo";
  workLines: WorkLine[];
  outsideManualSources: boolean;
  manualSourceMatch: string | null;
  isCompetitive: boolean;
  isOngEligible: boolean | null; // null if unknown
  reasons: string[];
  warnings: string[];
  daysRemaining: number | null;
  deadlineState: "abierta" | "proxima" | "cerrada" | "sin_fecha";
  scoreCap?: number; // kind cap the server applied; absent when the kind has none
}

export interface ConvocatoriaItem {
  codigoBDNS: string;
  id: number;
  titulo: string;
  organismo: string;
  nivelAdmin: string;
  fechaRecepcion: string;
  fechaInicioSolicitud: string | null;
  fechaFinSolicitud: string | null;
  textInicio: string | null;
  textFin: string | null;
  abierto: boolean;
  presupuestoTotal: number | null;
  tipoConvocatoria: string | null;
  beneficiarios: string[];
  regiones: string[];
  comunidadAutonoma: string;
  sedeElectronica: string | null;
  urlBasesReguladoras: string | null;
  urlBDNS: string;
  documentos: {
    id: number;
    nombre: string;
    descripcion: string;
    urlDescarga: string;
  }[];
  fit: FitAnalysis;
}

export interface PdfAnalysisResult {
  fileName: string;
  totalPages: number;
  charCount: number;
  title: string;
  organism: string | null;
  summary: string;
  beneficiaries: string[];
  budgetHighlights: string[];
  deadlineHighlights: string[];
  requirements: string[];
  fit: FitAnalysis;
  excerpt: string;
}

export interface BoeItem {
  identificador: string;
  fechaPublicacion: string;
  seccionCodigo: string;
  seccionNombre: string;
  esLicitacion: boolean;
  departamento: string;
  epigrafe: string;
  titulo: string;
  urlPdf: string | null;
  urlHtml: string | null;
  fit: FitAnalysis;
}

export type ExternalSourceId =
  | "eu-life"
  | "bocm"
  | "dog"
  | "fundacion-biodiversidad";

export interface SourceHealth {
  id: string;
  name: string;
  category: string;
  status: "ok" | "partial" | "error";
  count: number;
  url: string;
  note: string;
}

export interface ExternalSourceItem {
  id: string;
  sourceId: ExternalSourceId;
  sourceLabel: string;
  region: string;
  date: string;
  organismo: string;
  titulo: string;
  url: string;
  pdfUrl: string | null;
  fit: FitAnalysis;
}
