import { memo } from "./cache";
import { decodeHtml, fetchJson, fetchText, mapLimit } from "./http";
import type { Opportunity } from "./opportunity";

const DAY_MS = 86400000;
import { hasTerm, normalizeText, scoreConvocatoria } from "./scoring";
import type { BoeItem, SourceHealth } from "./types";

const BOE_API_BASE = "https://www.boe.es/datosabiertos/api/boe/sumario";
const SCAN_DAYS = 30;

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
  data?: { sumario?: { diario?: { seccion?: BoeSeccion[] }[] } };
}

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

interface RawBoeEntry {
  identificador: string;
  fecha: string; // YYYY-MM-DD
  seccionCodigo: string;
  seccionNombre: string;
  departamento: string;
  epigrafe: string;
  titulo: string;
  urlPdf: string | null;
  urlHtml: string | null;
  esLicitacion: boolean;
}

/** Grant-like notice (convocatoria / extracto / premios), not a procedural notice. Input: normalised text. */
export function isCallNotice(t: string): boolean {
  if (["subasta", "junta general", "provision de", "puesto", "concurso de meritos", "tribunal", "pruebas", "credito presupuestario", "amplia en", "modifica", "convocatoria de junta", "levantamiento", "actas previas", "oposicion", "proceso selectivo", "concedidas", "se conceden", "se resuelve", "resolucion definitiva", "corrige", "correccion de errores"].some((x) => t.includes(x))) {
    return false;
  }
  const grant = hasTerm(t, "subvenci") || hasTerm(t, "ayudas") || hasTerm(t, "premio") || hasTerm(t, "bases reguladoras");
  const call = hasTerm(t, "extracto") || hasTerm(t, "convoca") || hasTerm(t, "bases reguladoras");
  return grant && call;
}

export function isOpenTender(t: string): boolean {
  if (t.includes("formalizacion") || t.includes("adjudicacion") || t.includes("desistimiento") || t.includes("anulacion")) return false;
  return t.includes("licitacion") || t.includes("convocatoria del contrato") || t.includes("procedimiento abierto");
}

// Past daily summaries are immutable: cache them by date; only today's is always refetched.
async function fetchDay(date: Date): Promise<{ entries: RawBoeEntry[]; ok: boolean }> {
  if (ymd(date) === ymd(new Date())) return fetchDayUncached(date);
  const r = await memo(`boe:day:${ymd(date)}`, 7 * DAY_MS, async () => {
    const d = await fetchDayUncached(date);
    return d.ok ? d : null;
  }, { persist: true });
  return r ?? { entries: [], ok: false };
}

async function fetchDayUncached(date: Date): Promise<{ entries: RawBoeEntry[]; ok: boolean }> {
  const key = ymd(date);
  const json = await fetchJson<BoeSumarioResponse>(`${BOE_API_BASE}/${key}`, { timeoutMs: 9000 });
  if (!json) return { entries: [], ok: false };
  const diario = json.data?.sumario?.diario?.[0];
  if (json.status?.code !== "200" || !diario?.seccion) return { entries: [], ok: true }; // no BOE that day
  const iso = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
  const entries: RawBoeEntry[] = [];
  for (const sec of toArray(diario.seccion)) {
    const code = sec.codigo || "";
    if (!["3", "5A", "5B"].includes(code)) continue;
    for (const dep of toArray(sec.departamento)) {
      const groups: { epigrafe: string; items: BoeSummaryItem[] }[] = [
        { epigrafe: "", items: toArray(dep.item) },
        ...toArray(dep.epigrafe).map((e) => ({ epigrafe: e.nombre || "", items: toArray(e.item) })),
      ];
      for (const g of groups) {
        for (const it of g.items) {
          const t = normalizeText(it.titulo);
          const esLicitacion = code === "5A";
          if (esLicitacion ? !isOpenTender(t) : !isCallNotice(t)) continue;
          entries.push({
            identificador: it.identificador,
            fecha: iso,
            seccionCodigo: code,
            seccionNombre: sec.nombre || code,
            departamento: dep.nombre || "Administración General del Estado",
            epigrafe: g.epigrafe,
            titulo: it.titulo,
            urlPdf: typeof it.url_pdf === "string" ? it.url_pdf : it.url_pdf?.texto || null,
            urlHtml: it.url_html || `https://www.boe.es/diario_boe/txt.php?id=${it.identificador}`,
            esLicitacion,
          });
        }
      }
    }
  }
  return { entries, ok: true };
}

function scoreEntry(e: RawBoeEntry, extra = "") {
  return scoreConvocatoria({
    titulo: e.titulo,
    organismo: e.departamento,
    tipoConvocatoria: e.esLicitacion ? "Licitación pública" : "Extracto de convocatoria (BOE)",
    extraText: extra,
    kind: e.esLicitacion ? "licitacion" : "boletin",
  });
}

let scanCache: { timestamp: number; entries: RawBoeEntry[]; okDays: number; failedDays: number } | null = null;
const SCAN_TTL_MS = 15 * 60 * 1000;

async function scanBoe(refresh = false) {
  if (!refresh && scanCache && Date.now() - scanCache.timestamp < SCAN_TTL_MS) return scanCache;
  // BOE publishes Monday-Saturday
  const dates = Array.from({ length: SCAN_DAYS }, (_, i) => new Date(Date.now() - i * 86400000)).filter(
    (d) => d.getDay() !== 0
  );
  const days = await mapLimit(dates, 6, fetchDay);
  const map = new Map<string, RawBoeEntry>();
  for (const d of days) for (const e of d.entries) if (!map.has(e.identificador)) map.set(e.identificador, e);
  scanCache = {
    timestamp: Date.now(),
    entries: Array.from(map.values()),
    okDays: days.filter((d) => d.ok).length,
    failedDays: days.filter((d) => !d.ok).length,
  };
  return scanCache;
}

/** Pull "plazo" and "objeto/finalidad" sentences from an official notice's plain text. */
export function extractNoticeDetails(text: string): { deadlineText: string | null; summary: string | null } {
  const plazo =
    text.match(/(Fecha l[ií]mite de presentaci[oó]n[^]{5,140}?(?:\d{4}|\.))/i)?.[1] ||
    text.match(/Plazo para la recepci[oó]n de ofertas[^:]*:\s*([^]{5,120}?\d{4})/i)?.[1] ||
    text.match(/(?:Plazo de presentaci[oó]n de (?:solicitudes|ofertas|proposiciones)[^.:]*[.:]\s*)([^]{10,260}?\.)/i)?.[1] ||
    text.match(/(?:presentaci[oó]n de (?:solicitudes|ofertas|proposiciones)[^.]{0,40}?:?\s*)((?:hasta|el plazo|será|ser[aá]n?|de)[^]{5,220}?\.)/i)?.[1] ||
    null;
  const objeto = text.match(/(?:Objeto|Finalidad)\s*[.:]\s*([^]{20,400}?\.)\s/i)?.[1] || null;
  return { deadlineText: plazo ? plazo.trim() : null, summary: objeto ? objeto.trim() : null };
}

async function fetchNoticeDetails(e: RawBoeEntry): Promise<{ deadlineText: string | null; summary: string | null }> {
  // Published notices never change: cache the extracted details for 30 days.
  const r = await memo(`boe:notice:${e.identificador}`, 30 * DAY_MS, async () => {
    const html = await fetchText(`https://www.boe.es/diario_boe/txt.php?id=${e.identificador}`, { timeoutMs: 8000 });
    if (!html) return null;
    const bodyMatch = html.match(/<div id="textoxslt"[\s\S]*$/);
    return extractNoticeDetails(decodeHtml(bodyMatch ? bodyMatch[0] : html).slice(0, 12000));
  }, { persist: true });
  return r ?? { deadlineText: null, summary: null };
}

export function parseDeadline(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const m2 = normalizeText(text).match(/(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de (\d{4})/);
  if (m2) return `${m2[3]}-${String(months.indexOf(m2[2]) + 1).padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return null;
}

/** Adds natural/working days from the day after publication (approximation for "N días hábiles"). */
export function deadlineFromDays(published: string, text: string | null): string | null {
  if (!text) return null;
  const m = normalizeText(text).match(/(\d{1,3}|quince|diez|veinte|treinta|un mes)\s*(dias? habiles|dias? naturales|dias?|mes)/);
  if (!m) return null;
  const words: Record<string, number> = { diez: 10, quince: 15, veinte: 20, treinta: 30 };
  const start = new Date(`${published}T00:00:00`);
  if (m[1] === "un mes" || m[2] === "mes") {
    start.setMonth(start.getMonth() + 1);
    return start.toISOString().slice(0, 10);
  }
  let n = words[m[1]] ?? Number(m[1]);
  if (!n) return null;
  const habiles = m[2].includes("habil");
  const d = new Date(start);
  while (n > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (!habiles || (wd !== 0 && wd !== 6)) n--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getBoeRadar(refresh = false): Promise<{ items: Opportunity[]; health: SourceHealth }> {
  const scan = await scanBoe(refresh);
  const candidates = scan.entries
    .map((e) => ({ e, fit: scoreEntry(e) }))
    .filter(({ fit }) => fit.workLines.length > 0 && fit.score >= 35)
    .slice(0, 60);

  const details = await mapLimit(candidates, 6, ({ e }) => fetchNoticeDetails(e));
  const items: Opportunity[] = candidates.map(({ e }, i) => {
    const det = details[i];
    const explicit = parseDeadline(det.deadlineText);
    const deadline = explicit ?? deadlineFromDays(e.fecha, det.deadlineText);
    const fit = scoreConvocatoria({
      titulo: e.titulo,
      organismo: e.departamento,
      tipoConvocatoria: e.esLicitacion ? "Licitación pública" : "Extracto de convocatoria (BOE)",
      extraText: det.summary ?? "",
      fechaFinSolicitud: deadline,
      fechaInicioSolicitud: e.fecha,
      kind: e.esLicitacion ? "licitacion" : "boletin",
    });
    if (deadline && !explicit) fit.warnings.push("Fecha límite estimada a partir del plazo en días: confirmar en el texto oficial.");
    return {
      id: `boe:${e.identificador}`,
      source: "boe",
      sourceLabel: e.esLicitacion ? "BOE · Licitación" : "BOE",
      kind: e.esLicitacion ? "licitacion" : "boletin",
      titulo: e.titulo,
      organismo: e.departamento,
      region: "Estatal",
      nivelAdmin: "Estatal",
      publishedAt: e.fecha,
      opensAt: null,
      deadline,
      deadlineText: det.deadlineText,
      budget: null,
      amountText: null,
      tipo: e.esLicitacion ? "Licitación pública" : "Extracto de convocatoria",
      beneficiarios: [],
      url: e.urlHtml || `https://www.boe.es/diario_boe/txt.php?id=${e.identificador}`,
      basesUrl: null,
      documents: e.urlPdf ? [{ name: `${e.identificador}.pdf`, description: "Texto oficial (PDF)", url: e.urlPdf }] : [],
      summary: det.summary,
      fit,
    } satisfies Opportunity;
  });

  const filtered = items.filter((o) => o.fit.score >= 30);
  return {
    items: filtered,
    health: {
      id: "boe",
      name: "BOE · Boletín Oficial del Estado",
      category: "Boletín Oficial",
      status: scan.okDays === 0 ? "error" : scan.failedDays > 3 ? "partial" : "ok",
      count: filtered.length,
      url: "https://www.boe.es/datosabiertos/",
      note: `API de sumarios: ${SCAN_DAYS} días (${scan.okDays} leídos${scan.failedDays ? `, ${scan.failedDays} con error` : ""}). Solo extractos de convocatorias y licitaciones abiertas (sin formalizaciones) con encaje ambiental.`,
    },
  };
}

// Legacy shape for /api/boe
export async function getBoeOpportunities(options?: { refresh?: boolean }): Promise<{
  items: BoeItem[];
  scannedDays: number;
  cached: boolean;
  fetchedAt: string;
}> {
  const scan = await scanBoe(options?.refresh);
  const items: BoeItem[] = scan.entries
    .map((e) => ({ e, fit: scoreEntry(e) }))
    .filter(({ fit }) => fit.workLines.length > 0 && fit.score >= 35)
    .map(({ e, fit }) => ({
      identificador: e.identificador,
      fechaPublicacion: e.fecha.split("-").reverse().join("/"),
      seccionCodigo: e.seccionCodigo,
      seccionNombre: e.seccionNombre,
      esLicitacion: e.esLicitacion,
      departamento: e.departamento,
      epigrafe: e.epigrafe,
      titulo: e.titulo,
      urlPdf: e.urlPdf,
      urlHtml: e.urlHtml,
      fit,
    }))
    .sort((a, b) => b.fit.score - a.fit.score);
  return { items, scannedDays: SCAN_DAYS, cached: false, fetchedAt: new Date(scan.timestamp).toISOString() };
}
