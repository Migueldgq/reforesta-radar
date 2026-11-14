import { normalizeText, scoreConvocatoria } from "./scoring";
import type { BoeItem } from "./types";

const BOE_API_BASE = "https://www.boe.es/datosabiertos/api/boe/sumario";

const ENV_KEYWORDS = [
  "reforest",
  "forestal",
  "silvic",
  "restauracion",
  "biodiversidad",
  "medio ambiente",
  "medioambiental",
  "ambiental",
  "ecosistema",
  "humedal",
  "charca",
  "fauna",
  "flora",
  "habitat",
  "monte",
  "arbolado",
  "incendio",
  "custodia del territorio",
  "especies invasoras",
  "agroambiental",
];

interface BoeSummaryItem {
  identificador: string;
  titulo: string;
  url_pdf?: { texto?: string } | string;
  url_html?: string;
}

interface BoeEpigrafe {
  nombre?: string;
  item?: BoeSummaryItem | BoeSummaryItem[];
}

interface BoeDepartamento {
  nombre?: string;
  epigrafe?: BoeEpigrafe | BoeEpigrafe[];
  item?: BoeSummaryItem | BoeSummaryItem[];
}

interface BoeSeccion {
  codigo?: string;
  nombre?: string;
  departamento?: BoeDepartamento | BoeDepartamento[];
}

interface BoeSumarioResponse {
  status?: { code?: string };
  data?: {
    sumario?: {
      metadatos?: { fecha_publicacion?: string };
      diario?: { seccion?: BoeSeccion[] }[];
    };
  };
}

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function formatBoeDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function formatReadableDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
}

let boeCache: { timestamp: number; items: BoeItem[]; scannedDays: number } | null =
  null;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchDaySummary(yyyymmdd: string): Promise<BoeItem[]> {
  try {
    const res = await fetch(`${BOE_API_BASE}/${yyyymmdd}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as BoeSumarioResponse;
    if (json.status?.code !== "200") return [];

    const diario = json.data?.sumario?.diario?.[0];
    if (!diario?.seccion) return [];

    const results: BoeItem[] = [];
    for (const sec of diario.seccion) {
      const code = sec.codigo || "";
      // Focus on Section 5A (Licitaciones), 5B (Otros anuncios), and 3 (Otras disposiciones / subvenciones)
      if (!["3", "5A", "5B"].includes(code)) continue;

      const esLicitacion = code === "5A";
      for (const dep of toArray(sec.departamento)) {
        const departamento = dep.nombre || "Administración General";

        const groups: { epigrafe: string; items: BoeSummaryItem[] }[] = [];
        if (dep.item) {
          groups.push({ epigrafe: "", items: toArray(dep.item) });
        }
        for (const epi of toArray(dep.epigrafe)) {
          groups.push({
            epigrafe: epi.nombre || "",
            items: toArray(epi.item),
          });
        }

        for (const group of groups) {
          const epigrafe = group.epigrafe;
          for (const rawItem of group.items) {
            const textNorm = normalizeText(
              `${rawItem.titulo} ${departamento} ${epigrafe}`
            );
            const isEnv = ENV_KEYWORDS.some((kw) => textNorm.includes(kw));
            if (!isEnv) continue;

            const fit = scoreConvocatoria({
              titulo: rawItem.titulo,
              organismo: departamento,
              tipoConvocatoria: esLicitacion
                ? textNorm.includes("formalizacion")
                  ? "Formalización de contrato (BOE Sección V.A)"
                  : "Licitación pública (BOE Sección V.A)"
                : "Disposición / Convocatoria (BOE)",
              abierto: !textNorm.includes("formalizacion"),
              extraText: epigrafe,
            });

            // Filter out noise with very low score
            if (fit.score < 28) continue;

            const urlPdf =
              typeof rawItem.url_pdf === "string"
                ? rawItem.url_pdf
                : rawItem.url_pdf?.texto || null;

            results.push({
              identificador: rawItem.identificador,
              fechaPublicacion: formatReadableDate(yyyymmdd),
              seccionCodigo: code,
              seccionNombre: sec.nombre || code,
              esLicitacion,
              departamento,
              epigrafe,
              titulo: rawItem.titulo,
              urlPdf,
              urlHtml: rawItem.url_html || null,
              fit,
            });
          }
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

export async function getBoeOpportunities(options?: {
  refresh?: boolean;
}): Promise<{
  items: BoeItem[];
  scannedDays: number;
  cached: boolean;
  fetchedAt: string;
}> {
  if (!options?.refresh && boeCache && Date.now() - boeCache.timestamp < CACHE_TTL_MS) {
    return {
      items: boeCache.items,
      scannedDays: boeCache.scannedDays,
      cached: true,
      fetchedAt: new Date(boeCache.timestamp).toISOString(),
    };
  }

  // Scan the last 14 calendar days of BOE
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(formatBoeDate(d));
  }

  const dayResults = await Promise.all(dates.map(fetchDaySummary));
  const deduped = new Map<string, BoeItem>();
  for (const list of dayResults) {
    for (const item of list) {
      if (!deduped.has(item.identificador)) {
        deduped.set(item.identificador, item);
      }
    }
  }

  const items = Array.from(deduped.values()).sort((a, b) => {
    if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;
    return b.identificador.localeCompare(a.identificador);
  });

  boeCache = { timestamp: Date.now(), items, scannedDays: dates.length };

  return {
    items,
    scannedDays: dates.length,
    cached: false,
    fetchedAt: new Date(boeCache.timestamp).toISOString(),
  };
}
