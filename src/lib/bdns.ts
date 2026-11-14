import { deadlineFromDays, parseDeadline } from "./boe";
import { memo } from "./cache";
import { fetchJson as fetchJsonShared, mapLimit } from "./http";
import type { NivelAdmin, Opportunity } from "./opportunity";
import { inferComunidadAutonoma } from "./regions";
import { hasTerm, normalizeText, scoreConvocatoria, tierFor } from "./scoring";
import type {
  BDNSDetailResponse,
  BDNSRawSearchItem,
  ConvocatoriaItem,
  SourceHealth,
} from "./types";

const BDNS_BASE = "https://www.infosubvenciones.es/bdnstrans/api";

const DEFAULT_QUERIES = [
  "medio ambiente",
  "biodiversidad",
  "reforestacion",
  "forestal",
  "educacion ambiental",
  "restauracion",
  "custodia",
  "humedales",
  "naturaleza",
  "ecosistemas",
];

interface CacheEntry {
  timestamp: number;
  items: ConvocatoriaItem[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function searchBDNS(query: string, pageSize: number): Promise<BDNSRawSearchItem[]> {
  const url = `${BDNS_BASE}/convocatorias/busqueda?vpd=GE&page=0&pageSize=${pageSize}&descripcion=${encodeURIComponent(
    query
  )}`;
  const data = await fetchJson<{ content?: BDNSRawSearchItem[] }>(url);
  return data?.content ?? [];
}

export async function fetchBDNSDetail(numConv: string): Promise<BDNSDetailResponse | null> {
  const url = `${BDNS_BASE}/convocatorias?numConv=${encodeURIComponent(numConv)}&vpd=GE`;
  return fetchJson<BDNSDetailResponse>(url);
}

function mapDetailToItem(
  raw: BDNSRawSearchItem,
  detail: BDNSDetailResponse | null
): ConvocatoriaItem {
  const organismo =
    detail?.organo?.nivel3 ||
    detail?.organo?.nivel2 ||
    raw.nivel3 ||
    raw.nivel2 ||
    raw.nivel1 ||
    "Organismo público";

  const beneficiarios = (detail?.tiposBeneficiarios ?? []).map((b) => b.descripcion);
  const regiones = (detail?.regiones ?? []).map((r) => r.descripcion);
  const tipoConvocatoria = detail?.tipoConvocatoria ?? null;
  const presupuestoTotal = detail?.presupuestoTotal ?? null;
  const fechaInicioSolicitud = detail?.fechaInicioSolicitud ?? null;
  const fechaFinSolicitud = detail?.fechaFinSolicitud ?? null;
  const abierto = detail?.abierto ?? false;

  const fit = scoreConvocatoria({
    titulo: detail?.descripcion || raw.descripcion,
    organismo,
    tipoConvocatoria,
    beneficiarios,
    regiones,
    presupuestoTotal,
    fechaInicioSolicitud,
    fechaFinSolicitud,
    abierto,
    extraText: [
      detail?.descripcionFinalidad ?? "",
      detail?.descripcionBasesReguladoras ?? "",
    ].join(" "),
  });

  const nivelAdmin = detail?.organo?.nivel1 || raw.nivel1;
  const comunidadAutonoma = inferComunidadAutonoma(
    regiones,
    organismo,
    nivelAdmin
  );

  return {
    codigoBDNS: raw.numeroConvocatoria,
    id: raw.id,
    titulo: detail?.descripcion || raw.descripcion,
    organismo,
    nivelAdmin,
    fechaRecepcion: detail?.fechaRecepcion || raw.fechaRecepcion,
    fechaInicioSolicitud,
    fechaFinSolicitud,
    textInicio: detail?.textInicio ?? null,
    textFin: detail?.textFin ?? null,
    abierto,
    presupuestoTotal,
    tipoConvocatoria,
    beneficiarios,
    regiones,
    comunidadAutonoma,
    sedeElectronica: detail?.sedeElectronica ?? null,
    urlBasesReguladoras: detail?.urlBasesReguladoras ?? null,
    urlBDNS: `https://www.infosubvenciones.es/bdnstrans/GE/es/convocatoria/${raw.numeroConvocatoria}`,
    documentos: (detail?.documentos ?? []).map((doc) => ({
      id: doc.id,
      nombre: doc.nombreFic,
      descripcion: doc.descripcion,
      urlDescarga: `${BDNS_BASE}/convocatorias/documentos?idDocumento=${doc.id}`,
    })),
    fit,
  };
}

export async function getRadarConvocatorias(options?: {
  query?: string;
  refresh?: boolean;
}): Promise<{ items: ConvocatoriaItem[]; cached: boolean; fetchedAt: string }> {
  const query = options?.query?.trim() || "";
  const cacheKey = query.toLowerCase() || "__default__";

  if (!options?.refresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.timestamp < CACHE_TTL_MS) {
      return {
        items: hit.items,
        cached: true,
        fetchedAt: new Date(hit.timestamp).toISOString(),
      };
    }
  }

  const searches = query
    ? [searchBDNS(query, 24)]
    : DEFAULT_QUERIES.map((q) => searchBDNS(q, 10));

  const results = await Promise.all(searches);
  const deduped = new Map<string, BDNSRawSearchItem>();
  for (const list of results) {
    for (const item of list) {
      if (!deduped.has(item.numeroConvocatoria)) {
        deduped.set(item.numeroConvocatoria, item);
      }
    }
  }

  // Pre-score raw items so we enrich the most relevant 40 first
  const rankedRaw = Array.from(deduped.values())
    .map((raw) => ({
      raw,
      preScore: scoreConvocatoria({
        titulo: raw.descripcion,
        organismo: raw.nivel3 || raw.nivel2 || raw.nivel1,
      }).score,
    }))
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, 40);

  const enriched = await Promise.all(
    rankedRaw.map(async ({ raw }) => {
      const detail = await fetchBDNSDetail(raw.numeroConvocatoria);
      return mapDetailToItem(raw, detail);
    })
  );

  // Sort by fit score desc, then open/upcoming first
  enriched.sort((a, b) => {
    if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;
    return b.fechaRecepcion.localeCompare(a.fechaRecepcion);
  });

  cache.set(cacheKey, { timestamp: Date.now(), items: enriched });

  return {
    items: enriched,
    cached: false,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Unified radar connector (used by /api/oportunidades)
// ---------------------------------------------------------------------------

/**
 * Searches over the last ~12 months (closed annual calls are "next edition" leads):
 * keyword queries (Spanish + co-official languages), generic third-sector queries whose titles
 * don't say "ambiental", and organ queries for the environmental bodies that matter.
 */
interface RadarQuery {
  q?: string;
  ngoOnly?: boolean;
  /** BDNS organ id (`organos=` filter) */
  organ?: number;
  /** results get enrichment priority and looser topic filtering */
  priority?: boolean;
}
const RADAR_QUERIES: RadarQuery[] = [
  { q: "medio ambiente" },
  { q: "medioambiental" },
  { q: "medioambientales" },
  { q: "medi ambient" },
  { q: "medio ambiente", ngoOnly: true },
  { q: "ambiental", ngoOnly: true },
  { q: "ambientales", ngoOnly: true },
  { q: "ingurumen" },
  { q: "biodiversidad" },
  { q: "biodiversitat" },
  { q: "forestal" },
  { q: "forestales" },
  { q: "montes", ngoOnly: true },
  { q: "reforestación" },
  { q: "repoblación forestal" },
  { q: "restauración ecológica" },
  { q: "restauración ambiental" },
  { q: "restauración de ecosistemas" },
  { q: "renaturalización" },
  { q: "custodia del territorio" },
  { q: "custòdia del territori" },
  { q: "educación ambiental" },
  { q: "educació ambiental" },
  { q: "voluntariado ambiental" },
  { q: "voluntariado", ngoOnly: true },
  { q: "especies invasoras" },
  { q: "exóticas invasoras" },
  { q: "humedales" },
  { q: "anfibios" },
  { q: "fauna", ngoOnly: true },
  { q: "espacios naturales" },
  { q: "patrimonio natural" },
  { q: "red natura" },
  { q: "parque nacional" },
  { q: "parques naturales" },
  { q: "conservación de la naturaleza" },
  { q: "cambio climático", ngoOnly: true },
  { q: "desarrollo rural", ngoOnly: true },
  { q: "agroambiental" },
  { q: "sostenibilidad", ngoOnly: true },
  { q: "infraestructura verde" },
  { q: "proyectos ambientales" },
  { q: "entidades ambientales" },
  { q: "natura", ngoOnly: true },
  // generic third-sector calls (title may not say "ambiental")
  { q: "interés general", ngoOnly: true, priority: true },
  { q: "interés social", ngoOnly: true, priority: true },
  { q: "IRPF", priority: true },
  { q: "0,7", ngoOnly: true, priority: true },
  { q: "tercer sector", priority: true },
  { q: "entidades sin ánimo de lucro", ngoOnly: true, priority: true },
  { q: "entitats sense ànim de lucre", priority: true },
  // organs (MITECO family)
  { organ: 6489, priority: true }, // MITECO · DG Servicios (convocatorias de interés general)
  { organ: 6430, priority: true }, // DG Biodiversidad, Bosques y Desertificación
  { organ: 466, priority: true }, // Fundación Biodiversidad
  { organ: 557, priority: true }, // OAPN
  { organ: 716, priority: true }, // Secretaría de Estado de Medio Ambiente
  { organ: 719, priority: true }, // Oficina Española del Cambio Climático
  { organ: 1723, priority: true }, // DG del Agua
  { organ: 6493, priority: true }, // DG Políticas contra la Despoblación
  { organ: 1850, priority: true },
  { organ: 1851, priority: true },
  { organ: 1852, priority: true },
  { organ: 1853, priority: true },
  { organ: 1987, priority: true },
  { organ: 1988, priority: true },
  { organ: 1989, priority: true },
  { organ: 1990, priority: true },
  { organ: 1991, priority: true }, // Confederaciones hidrográficas
];

const PRE_DROP_TERMS = [
  "nominativa",
  "nominativas",
  "subv.nom",
  "subv. nom",
  "concesion directa",
  "concessio directa",
  "convenio",
  "conveni",
  "aportacion",
];

const MAX_ENRICH = 230;
const SEARCH_WINDOW_DAYS = 365;

function ddmmyyyy(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

interface SearchPage {
  content?: BDNSRawSearchItem[];
  totalElements?: number;
}

async function searchPaged(
  q: RadarQuery,
  fechaDesde: string,
  maxPages: number
): Promise<{ items: BDNSRawSearchItem[]; ok: boolean; total: number }> {
  const params = [
    "vpd=GE",
    "pageSize=50",
    `fechaDesde=${encodeURIComponent(fechaDesde)}`,
    q.q ? `descripcion=${encodeURIComponent(q.q)}` : "",
    q.ngoOnly ? "tiposBeneficiario=2" : "",
    q.organ ? `organos=${q.organ}` : "",
  ].filter(Boolean);
  const base = `${BDNS_BASE}/convocatorias/busqueda?${params.join("&")}`;
  const first = await fetchJsonShared<SearchPage>(`${base}&page=0`, { timeoutMs: 8000 });
  if (!first) return { items: [], ok: false, total: 0 };
  const items = [...(first.content ?? [])];
  const total = first.totalElements ?? items.length;
  const pages = Math.min(maxPages, Math.ceil(total / 50));
  for (let p = 1; p < pages; p++) {
    const more = await fetchJsonShared<SearchPage>(`${base}&page=${p}`, { timeoutMs: 8000 });
    if (!more?.content?.length) break;
    items.push(...more.content);
  }
  return { items, ok: true, total };
}

function bdnsNivel(nivel1: string | null | undefined): NivelAdmin {
  const n = normalizeText(nivel1 ?? "");
  if (n.includes("estado")) return "Estatal";
  if (n.includes("autonomica")) return "Autonómica";
  if (n.includes("local")) return "Local";
  return "Otros";
}

function preScore(raw: BDNSRawSearchItem): number {
  const text = normalizeText(`${raw.descripcion} ${raw.descripcionLeng ?? ""}`);
  if (PRE_DROP_TERMS.some((t) => hasTerm(text, t))) {
    return -1;
  }
  const fit = scoreConvocatoria({
    titulo: `${raw.descripcion} ${raw.descripcionLeng ?? ""}`,
    organismo: raw.nivel3 || raw.nivel2 || raw.nivel1,
  });
  // tiny recency bonus (0-5)
  const ageDays = (Date.now() - new Date(raw.fechaRecepcion).getTime()) / 86400000;
  return fit.score + Math.max(0, 5 - ageDays / 30);
}

function detailToOpportunity(raw: BDNSRawSearchItem, d: BDNSDetailResponse): Opportunity {
  const organismo = [d.organo?.nivel3, d.organo?.nivel2].filter(Boolean).join(" · ") || raw.nivel3 || raw.nivel2 || raw.nivel1;
  const regiones = (d.regiones ?? []).map((r) => r.descripcion);
  const nivelAdmin = bdnsNivel(d.organo?.nivel1 || raw.nivel1);
  let region = inferComunidadAutonoma(regiones, `${d.organo?.nivel2 ?? ""} ${organismo}`, d.organo?.nivel1 || raw.nivel1);
  if (region.startsWith("Estatal")) region = nivelAdmin === "Estatal" ? "Estatal" : "Sin determinar";
  const beneficiarios = (d.tiposBeneficiarios ?? []).map((b) => b.descripcion);
  const titulo = d.descripcion || raw.descripcion;
  const finalidad = d.descripcionFinalidad ?? "";
  const bases = d.descripcionBasesReguladoras ?? "";
  const objetivos = ((d as unknown as { objetivos?: { descripcion: string }[] }).objetivos ?? [])
    .map((o) => o.descripcion)
    .join(". ");

  // BDNS often gives only a relative term ("20 Días hábiles", "01 Mesos", "Línea 2- 31.10.26").
  // Estimate the end from the start date, or from the BDNS registration date when the start is
  // "día siguiente a la publicación del extracto" (extracts are normally published within days).
  let estimatedEnd: string | null = null;
  if (!d.fechaFinSolicitud && d.textFin) {
    const base = d.fechaInicioSolicitud ?? d.fechaRecepcion ?? raw.fechaRecepcion;
    estimatedEnd = parseDeadline(d.textFin) ?? (base ? deadlineFromDays(base, d.textFin) : null);
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  // BDNS says "abierto" but our estimate is already past: don't contradict the official flag, flag it.
  const conflict = !!estimatedEnd && estimatedEnd < todayIso && d.abierto === true;
  const deadline = d.fechaFinSolicitud ?? (conflict ? null : estimatedEnd);

  const fit = scoreConvocatoria({
    titulo,
    organismo,
    tipoConvocatoria: d.tipoConvocatoria,
    beneficiarios,
    regiones,
    region,
    presupuestoTotal: d.presupuestoTotal,
    fechaInicioSolicitud: d.fechaInicioSolicitud,
    fechaFinSolicitud: deadline,
    abierto: d.abierto,
    extraText: `${bases} ${objetivos} ${d.descripcionLeng ?? ""}`,
    kind: "subvencion",
  });
  if (conflict) {
    fit.deadlineState = "sin_fecha";
    fit.score = Math.min(60, Math.max(0, fit.score - 12));
    fit.warnings.push(`BDNS la marca abierta, pero el plazo («${d.textFin}») contado desde la publicación ya habría vencido: verificar.`);
  } else if (estimatedEnd && !d.fechaFinSolicitud) {
    fit.warnings.push(`Fecha límite estimada a partir de «${d.textFin}»: confirmar en el extracto oficial.`);
  }
  // Territory (municipal / other region) is scored later, in aggregate.ts via geographicFit().
  fit.tier = tierFor(fit.score);

  const deadlineText =
    d.fechaFinSolicitud ? null : [d.textInicio, d.textFin].filter(Boolean).join(" · ") || null;
  const summaryParts = [bases && `Bases: ${bases}`, finalidad && `Finalidad: ${finalidad}.`].filter(Boolean);

  return {
    id: `bdns:${raw.numeroConvocatoria}`,
    source: "bdns",
    sourceLabel: "BDNS",
    kind: "subvencion",
    titulo,
    organismo,
    region,
    nivelAdmin,
    publishedAt: d.fechaRecepcion || raw.fechaRecepcion || null,
    opensAt: d.fechaInicioSolicitud ?? null,
    deadline: deadline ?? null,
    deadlineText,
    budget: d.presupuestoTotal ?? null,
    amountText: null,
    tipo: d.tipoConvocatoria ?? null,
    beneficiarios,
    url: `https://www.infosubvenciones.es/bdnstrans/GE/es/convocatoria/${raw.numeroConvocatoria}`,
    basesUrl: d.urlBasesReguladoras || d.sedeElectronica || null,
    documents: (d.documentos ?? []).map((doc) => ({
      name: doc.nombreFic,
      description: doc.descripcion,
      url: `${BDNS_BASE}/convocatorias/documentos?idDocumento=${doc.id}`,
      docId: doc.id,
    })),
    summary: summaryParts.length ? summaryParts.join(" ").slice(0, 600) : null,
    fit,
  };
}

/** Lightweight item from the search row only (no detail fetched): keeps recall without the cost. */
function rawToOpportunity(raw: BDNSRawSearchItem): Opportunity {
  const organismo = [raw.nivel3, raw.nivel2].filter(Boolean).join(" · ") || raw.nivel1;
  const nivelAdmin = bdnsNivel(raw.nivel1);
  let region = inferComunidadAutonoma([], `${raw.nivel2 ?? ""} ${organismo}`, raw.nivel1);
  if (region.startsWith("Estatal")) region = nivelAdmin === "Estatal" ? "Estatal" : "Sin determinar";
  const fit = scoreConvocatoria({
    titulo: raw.descripcion,
    organismo,
    region,
    extraText: raw.descripcionLeng ?? "",
    kind: "subvencion",
  });
  fit.score = Math.max(0, fit.score - 5);
  fit.tier = tierFor(fit.score);
  fit.warnings.push("Ficha BDNS no cargada en este barrido: abre la convocatoria para ver plazo, tipo y beneficiarios.");
  return {
    id: `bdns:${raw.numeroConvocatoria}`,
    source: "bdns",
    sourceLabel: "BDNS",
    kind: "subvencion",
    titulo: raw.descripcion,
    organismo,
    region,
    nivelAdmin,
    publishedAt: raw.fechaRecepcion || null,
    opensAt: null,
    deadline: null,
    deadlineText: null,
    budget: null,
    amountText: null,
    tipo: null,
    beneficiarios: [],
    url: `https://www.infosubvenciones.es/bdnstrans/GE/es/convocatoria/${raw.numeroConvocatoria}`,
    basesUrl: null,
    documents: [],
    summary: null,
    fit,
  };
}

export async function getBdnsOpportunities(): Promise<{ items: Opportunity[]; health: SourceHealth }> {
  const since = new Date(Date.now() - SEARCH_WINDOW_DAYS * 86400000);
  const fechaDesde = ddmmyyyy(since);
  const healthBase = {
    id: "bdns",
    name: "BDNS · Base de Datos Nacional de Subvenciones",
    category: "API Oficial",
    url: "https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias",
  };

  const searches = await mapLimit(RADAR_QUERIES, 6, (q) => searchPaged(q, fechaDesde, q.priority ? 2 : 4));
  const okSearches = searches.filter((s) => s.ok).length;
  const deduped = new Map<string, BDNSRawSearchItem>();
  const priority = new Set<string>();
  searches.forEach((s, i) => {
    for (const it of s.items) {
      if (!deduped.has(it.numeroConvocatoria)) deduped.set(it.numeroConvocatoria, it);
      if (RADAR_QUERIES[i].priority) priority.add(it.numeroConvocatoria);
    }
  });

  const ranked = Array.from(deduped.values())
    .map((raw) => ({ raw, pre: preScore(raw) + (priority.has(raw.numeroConvocatoria) ? 15 : 0) }))
    .filter((r) => r.pre > 0)
    .sort((a, b) => b.pre - a.pre);
  const dropped = deduped.size - ranked.length;
  const toEnrich = ranked.slice(0, MAX_ENRICH);
  const notEnriched = ranked.slice(MAX_ENRICH);

  // Details of a published call rarely change: cache by number (24 h; 3 h while it has no deadline yet),
  // so a refresh only hits the API for calls not seen before.
  const details = await mapLimit(toEnrich, 8, ({ raw }) =>
    memo<BDNSDetailResponse>(
      `bdns:detail:${raw.numeroConvocatoria}`,
      (d) => (d.fechaFinSolicitud ? 24 : 3) * 3600000,
      () =>
        fetchJsonShared<BDNSDetailResponse>(
          `${BDNS_BASE}/convocatorias?numConv=${encodeURIComponent(raw.numeroConvocatoria)}&vpd=GE`,
          { timeoutMs: 8000 }
        ),
      { persist: true }
    )
  );

  const items: Opportunity[] = [];
  let failed = 0;
  const keep = (o: Opportunity, isPriority: boolean) =>
    o.fit.isCompetitive &&
    o.fit.score >= 25 &&
    (o.fit.workLines.length > 0 || (isPriority && o.fit.isOngEligible === true));
  toEnrich.forEach(({ raw }, i) => {
    const d = details[i];
    const opp = d ? detailToOpportunity(raw, d) : rawToOpportunity(raw);
    if (!d) failed++;
    if (keep(opp, priority.has(raw.numeroConvocatoria))) items.push(opp);
  });
  let lite = 0;
  for (const { raw } of notEnriched) {
    const opp = rawToOpportunity(raw);
    if (opp.fit.workLines.length > 0 && keep(opp, false)) {
      items.push(opp);
      lite++;
    }
  }

  const status: SourceHealth["status"] =
    okSearches === 0 ? "error" : okSearches < searches.length || failed > toEnrich.length * 0.2 ? "partial" : "ok";
  return {
    items,
    health: {
      ...healthBase,
      status,
      count: items.length,
      note: `${RADAR_QUERIES.length} búsquedas (${okSearches} OK; temáticas, tercer sector e interés general, y por organismo MITECO/F. Biodiversidad/OAPN/confederaciones) desde ${fechaDesde}: ${deduped.size} convocatorias únicas, ${dropped} descartadas (nominativas, convenios, concesión directa), ${toEnrich.length} con ficha completa${failed ? ` (${failed} fallidas)` : ""}, ${lite} solo con datos de búsqueda; ${items.length} relevantes.`,
    },
  };
}
