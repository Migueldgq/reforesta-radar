import { inferComunidadAutonoma } from "./regions";
import { scoreConvocatoria } from "./scoring";
import type {
  BDNSDetailResponse,
  BDNSRawSearchItem,
  ConvocatoriaItem,
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
      urlDescarga: `${BDNS_BASE}/convocatorias/documentos?idDoc=${doc.id}`,
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
