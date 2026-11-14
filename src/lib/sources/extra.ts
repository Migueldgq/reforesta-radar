// Extra live sources beyond BDNS/BOE/BOCM/DOG/EU/FB:
//  - BOJA (Andalucía) Atom feed of the latest bulletins
//  - BOCYL (Castilla y León) daily summaries, last ~10 days
//  - TED (EU tenders) API v3, Spanish forestry / environmental notices still open
//  - Fundación Montemadrid public calls page
import type { Opportunity, OpportunityKind, NivelAdmin } from "../opportunity";
import type { SourceHealth } from "../types";
import { normalizeText, scoreConvocatoria } from "../scoring";

const UA = "Mozilla/5.0 ReforestaRadar/1.0";
const MIN_SCORE = 35;

type Result = { items: Opportunity[]; health: SourceHealth };

async function get(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// Topic filter (title + organism). Narrower than the scorer: bulletins carry lots of noise.
const TOPIC_TERMS = [
  "reforest", "forestal", "forest", "silvic", "monte", "arbol", "arbolado", "biodivers",
  "medio ambiente", "medioambient", "ambiental", "espacios naturales", "espacio natural",
  "red natura", "natura 2000", "habitat", "fauna", "flora", "especies", "humedal", "rio ",
  "fluvial", "ribera", "restauraci", "incendio", "custodia del territorio", "voluntariado",
  "educacion ambiental", "cambio climatico", "clima", "desarrollo rural", "agroambient",
  "paisaje", "vias pecuarias", "reserva natural", "parque natural", "parque nacional",
  "sostenib", "entidades sin animo", "sin fines de lucro",
];

// Things an NGO cannot apply to, or that are not calls at all.
const NOISE = [
  "nombramiento", "libre designacion", "personal estatutario", "oposicion", "proceso selectivo",
  "puesto de trabajo", "plaza", "funcionari", "por la que se resuelve", "se resuelve",
  "se conceden", "concesion de", "adjudica", "formalizacion", "se emplaza", "recurso contencioso",
  "caza", "coto", "pesca", "pesquer", "marisqu", "aprovechamiento", "deslinde", "expropiac",
  "autorizacion ambiental", "evaluacion de impacto", "informe de impacto", "declaracion de impacto",
  "modificacion de la autorizacion", "sancion", "notifica", "informacion publica",
  "tasas", "calendario de", "estatutos", "colegio oficial", "estructura organica",
  "informe ambiental", "declaracion ambiental", "plan general de ordenacion", "normas urbanisticas",
  "suelo rustico", "planeamiento", "correccion de errores",
];

function topical(text: string): boolean {
  const n = normalizeText(text);
  return TOPIC_TERMS.some((t) => n.includes(t));
}
function noisy(text: string): boolean {
  const n = normalizeText(text);
  return NOISE.some((t) => n.includes(t));
}

function bulletinKind(titulo: string): OpportunityKind {
  const n = normalizeText(titulo);
  if (/(convoca|extracto|bases reguladoras)/.test(n) && /(subvenc|ayuda|premio)/.test(n)) return "subvencion";
  if (/(licitacion|anuncio de licitacion|contratacion de|contrato de servicio)/.test(n)) return "licitacion";
  return "boletin";
}

const MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07",
  agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function health(
  id: string, name: string, category: string, url: string, count: number, note: string,
  status: SourceHealth["status"] = "ok"
): SourceHealth {
  return { id, name, category, status, count, url, note };
}

function errHealth(id: string, name: string, category: string, url: string, e: unknown): Result {
  const msg = e instanceof Error ? e.message : String(e);
  return { items: [], health: health(id, name, category, url, 0, `Fuente no disponible ahora: ${msg}`, "error") };
}

function bulletinOpportunity(o: {
  source: string; sourceLabel: string; nativeId: string; titulo: string; organismo: string;
  region: string; publishedAt: string | null; url: string; pdfUrl: string | null; section: string;
}): Opportunity | null {
  const fit = scoreConvocatoria({
    titulo: o.titulo,
    organismo: o.organismo,
    tipoConvocatoria: o.section,
    regiones: [o.region],
    extraText: o.section,
  });
  if (fit.score < MIN_SCORE) return null;
  const kind = bulletinKind(o.titulo);
  const isLocal = /ayuntamiento|diputaci|administracion local|mancomunidad|cabildo|consell/.test(
    normalizeText(o.organismo + " " + o.section)
  );
  return {
    id: `${o.source}:${o.nativeId}`,
    source: o.source,
    sourceLabel: o.sourceLabel,
    kind,
    titulo: o.titulo,
    organismo: o.organismo,
    region: o.region,
    nivelAdmin: isLocal ? "Local" : "Autonómica",
    publishedAt: o.publishedAt,
    opensAt: null,
    deadline: null,
    deadlineText: kind === "subvencion" ? "Plazo en el texto de la disposición (ver PDF)" : null,
    budget: null,
    amountText: null,
    tipo: o.section || null,
    beneficiarios: [],
    url: o.url,
    basesUrl: null,
    documents: o.pdfUrl ? [{ name: "Disposición (PDF)", description: o.sourceLabel, url: o.pdfUrl }] : [],
    summary: `Publicado en ${o.sourceLabel}${o.section ? ` · ${o.section}` : ""}.`,
    fit,
  };
}

// ---------------------------------------------------------------- BOJA
export async function fetchBoja(): Promise<Result> {
  const id = "boja", name = "BOJA · Junta de Andalucía", cat = "Boletín Oficial";
  const feed = "https://www.juntadeandalucia.es/boja/distribucion/boja.xml";
  try {
    const xml = await (await get(feed)).text();
    const items: Opportunity[] = [];
    const seen = new Set<string>();
    let scanned = 0;
    for (const entry of xml.split("<entry>").slice(1)) {
      const title = clean(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const dm = normalizeText(title).match(/de (\d{1,2}) de ([a-z]+) de (\d{4})/);
      const published = dm && MONTHS[dm[2]] ? `${dm[3]}-${MONTHS[dm[2]]}-${dm[1].padStart(2, "0")}` : null;
      const content = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "";
      // Walk <p> (section / organism headers) and <li> (dispositions) in order.
      let section = "";
      let organismo = "Junta de Andalucía";
      const tokenRe = /<p>([\s\S]*?)<\/p>|<li>([\s\S]*?)<\/li>/g;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(content))) {
        if (m[1] !== undefined) {
          const txt = clean(m[1]);
          if (/<strong>/.test(m[1])) section = txt;
          else organismo = txt;
          continue;
        }
        scanned++;
        const li = m[2];
        const links = [...li.matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g)];
        const html = links.find((l) => /\.html$/.test(l[1]));
        const pdf = links.find((l) => /\.pdf$/i.test(l[1]));
        if (!html) continue;
        const titulo = clean(html[2]);
        if (!topical(`${titulo} ${organismo}`) || noisy(titulo)) continue;
        const url = html[1].replace(/^http:/, "https:");
        const op = bulletinOpportunity({
          source: id, sourceLabel: "BOJA", nativeId: url.replace(/^.*\/boja\//, "").replace(/\.html$/, ""),
          titulo, organismo, region: "Andalucía", publishedAt: published, url,
          pdfUrl: pdf ? pdf[1].replace(/^http:/, "https:") : null, section,
        });
        if (op && !seen.has(op.id)) { seen.add(op.id); items.push(op); }
      }
    }

    // The feed only carries ~2 days: also read the summaries of the previous ordinary bulletins.
    const latest = Math.max(0, ...[...xml.matchAll(/\/boja\/(\d{4})\/(\d{1,3})\//g)].map((x) => Number(x[2])));
    const year = xml.match(/\/boja\/(\d{4})\//)?.[1];
    let pagesOk = 0;
    if (latest > 0 && year) {
      const nums: number[] = [];
      for (let k = latest - 1; k >= Math.max(1, latest - 8); k--) nums.push(k);
      const pages = await Promise.all(
        nums.map(async (num) => {
          try {
            const html = await (await get(`https://www.juntadeandalucia.es/boja/${year}/${num}/`)).text();
            pagesOk++;
            return { num, html };
          } catch {
            return null;
          }
        })
      );
      for (const page of pages) {
        if (!page) continue;
        const dm = page.html.match(/<span class="nota">[\s\S]*?(\d{2})\/(\d{2})\/(\d{4})/);
        const published = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
        let section = "";
        let organismo = "Junta de Andalucía";
        let pendingTitle: string | null = null;
        let pendingPdf: string | null = null;
        const tokenRe = /<h[23]>([\s\S]*?)<\/h[23]>|<p class="h5[^"]*">([\s\S]*?)<\/p>|<div class="item[^"]*">\s*<p>([\s\S]*?)<\/p>|href="(BOJA[^"]+\.pdf)"|href="(\/boja\/\d{4}\/\d+\/\d+)"/g;
        let m: RegExpExecArray | null;
        while ((m = tokenRe.exec(page.html))) {
          if (m[1] !== undefined) { section = clean(m[1]); continue; }
          if (m[2] !== undefined) { organismo = clean(m[2]); continue; }
          if (m[3] !== undefined) { pendingTitle = clean(m[3]); pendingPdf = null; continue; }
          if (m[4] !== undefined) { pendingPdf = `https://www.juntadeandalucia.es/boja/${year}/${page.num}/${m[4]}`; continue; }
          const path = m[5];
          const titulo = pendingTitle;
          pendingTitle = null;
          if (!titulo) continue;
          scanned++;
          if (!topical(`${titulo} ${organismo}`) || noisy(titulo)) continue;
          const op = bulletinOpportunity({
            source: id, sourceLabel: "BOJA", nativeId: path.replace(/^\/boja\//, ""),
            titulo, organismo, region: "Andalucía", publishedAt: published,
            url: `https://www.juntadeandalucia.es${path}.html`, pdfUrl: pendingPdf, section,
          });
          if (op && !seen.has(op.id)) { seen.add(op.id); items.push(op); }
        }
      }
    }
    return {
      items,
      health: health(id, name, cat, feed, items.length,
        `Feed Atom + ${pagesOk} sumarios anteriores (${scanned} disposiciones revisadas, ${items.length} relevantes).`),
    };
  } catch (e) {
    return errHealth(id, name, cat, feed, e);
  }
}

// ---------------------------------------------------------------- BOCYL
export async function fetchBocyl(): Promise<Result> {
  const id = "bocyl", name = "BOCYL · Castilla y León", cat = "Boletín Oficial";
  const home = "https://bocyl.jcyl.es/";
  try {
    // Last 10 calendar days (≈7 bulletins); weekends simply return no dispositions.
    const days: Date[] = [];
    for (let i = 0; i < 10; i++) days.push(new Date(Date.now() - i * 86400000));
    let ok = 0;
    let scanned = 0;
    const pages = await Promise.all(
      days.map(async (d) => {
        const dd = String(d.getUTCDate()).padStart(2, "0");
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const yyyy = d.getUTCFullYear();
        try {
          const html = await (await get(`${home}boletin.do?fechaBoletin=${dd}/${mm}/${yyyy}`)).text();
          ok++;
          return { html, date: `${yyyy}-${mm}-${dd}`, stamp: `${dd}${mm}${yyyy}` };
        } catch {
          return null;
        }
      })
    );
    if (ok === 0) throw new Error("ningún sumario descargado");
    const items: Opportunity[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      if (!page) continue;
      // Only dispositions of that exact day (page falls back to other dates otherwise).
      if (!page.html.includes(`BOCYL-D-${page.stamp}`)) continue;
      const body = page.html.replace(/<!--[\s\S]*?-->/g, "");
      let section = "";
      let organismo = "Junta de Castilla y León";
      let pendingTitle: string | null = null;
      const tokenRe = /<h[34][^>]*>([\s\S]*?)<\/h[34]>|<h5[^>]*>([\s\S]*?)<\/h5>|<p>([\s\S]*?)<\/p>|href='(https:\/\/bocyl\.jcyl\.es\/boletines\/[^']+\.pdf)'/g;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(body))) {
        if (m[1] !== undefined) { section = clean(m[1]); continue; }
        if (m[2] !== undefined) { organismo = clean(m[2]); continue; }
        if (m[3] !== undefined) { pendingTitle = clean(m[3]); continue; }
        const pdfUrl = m[4];
        const titulo = pendingTitle;
        pendingTitle = null;
        if (!titulo || !/BOCYL-D-/.test(pdfUrl)) continue;
        const nativeId = pdfUrl.match(/(BOCYL-D-[\d-]+)\.pdf/)?.[1] ?? pdfUrl;
        if (seen.has(nativeId)) continue;
        seen.add(nativeId);
        scanned++;
        if (!topical(`${titulo} ${organismo}`) || noisy(titulo)) continue;
        const htmlUrl = `${home}html/${page.date.replace(/-/g, "/")}/html/${nativeId}.do`;
        const op = bulletinOpportunity({
          source: id, sourceLabel: "BOCYL", nativeId, titulo, organismo,
          region: "Castilla y León", publishedAt: page.date, url: htmlUrl, pdfUrl, section,
        });
        if (op) items.push(op);
      }
    }
    return {
      items,
      health: health(id, name, cat, home, items.length,
        `Sumarios de los últimos 10 días (${scanned} disposiciones revisadas, ${items.length} relevantes).`,
        ok < days.length ? "partial" : "ok"),
    };
  } catch (e) {
    return errHealth(id, name, cat, home, e);
  }
}

// ---------------------------------------------------------------- TED
const NUTS2: Record<string, string> = {
  ES11: "Galicia", ES12: "Principado de Asturias", ES13: "Cantabria", ES21: "País Vasco",
  ES22: "Comunidad Foral de Navarra", ES23: "La Rioja", ES24: "Aragón", ES30: "Comunidad de Madrid",
  ES41: "Castilla y León", ES42: "Castilla-La Mancha", ES43: "Extremadura", ES51: "Cataluña",
  ES52: "Comunitat Valenciana", ES53: "Illes Balears", ES61: "Andalucía", ES62: "Región de Murcia",
  ES63: "Ceuta", ES64: "Melilla", ES70: "Canarias",
};

interface TedNotice {
  "publication-number": string;
  "notice-title"?: Record<string, string>;
  "buyer-name"?: Record<string, string[]>;
  "publication-date"?: string;
  "deadline-receipt-tender-date-lot"?: string[];
  "estimated-value-proc"?: string | number | null;
  "place-of-performance"?: string[];
  "classification-cpv"?: string[];
}

export async function fetchTed(): Promise<Result> {
  const id = "ted", name = "TED · Licitaciones UE (España)", cat = "Licitaciones";
  const api = "https://api.ted.europa.eu/v3/notices/search";
  try {
    const since = iso(new Date(Date.now() - 75 * 86400000)).replace(/-/g, "");
    // CPV: 772 forestry, 90720000 environmental protection, 9071x env. impact/planning,
    // 92530000 botanical gardens / nature reserves, 92534000 wildlife preservation, 03452000 trees.
    const query =
      `buyer-country=ESP AND notice-type=cn-standard AND publication-date>=${since} AND ` +
      `classification-cpv IN (77200000 77230000 77231000 90720000 90711000 90712000 92530000 92534000 03452000)`;
    const res = await get(api, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query,
        fields: [
          "notice-title", "buyer-name", "publication-date", "deadline-receipt-tender-date-lot",
          "estimated-value-proc", "place-of-performance", "classification-cpv",
        ],
        limit: 100,
        page: 1,
      }),
    });
    const json = (await res.json()) as { notices?: TedNotice[]; totalNoticeCount?: number };
    const today = iso(new Date());
    const items: Opportunity[] = [];
    const seenTitles = new Set<string>();
    for (const n of json.notices ?? []) {
      const pub = n["publication-number"];
      const rawTitle = n["notice-title"]?.spa ?? n["notice-title"]?.eng ?? "";
      // "España – <CPV label> – <real title>"
      const parts = rawTitle.split(" – ");
      const cpvLabel = parts.length >= 3 ? parts[1] : "";
      const titulo = (parts.length >= 3 ? parts.slice(2).join(" – ") : rawTitle).trim();
      if (!titulo) continue;
      const deadline = (n["deadline-receipt-tender-date-lot"] ?? []).map((d) => d.slice(0, 10)).sort().pop() ?? null;
      if (!deadline || deadline < today) continue; // only still-open tenders
      const key = normalizeText(titulo);
      if (seenTitles.has(key)) continue; // TED republishes corrigenda under new numbers
      seenTitles.add(key);
      const organismo = (n["buyer-name"]?.spa ?? Object.values(n["buyer-name"] ?? {})[0] ?? ["Poder adjudicador"])[0];
      const nuts = (n["place-of-performance"] ?? []).filter((p) => /^ES\d/.test(p)).map((p) => p.slice(0, 4));
      const regions = [...new Set(nuts.map((c) => NUTS2[c]).filter(Boolean))];
      const region = regions.length === 1 ? regions[0] : "Estatal";
      const budget = n["estimated-value-proc"] != null ? Number(n["estimated-value-proc"]) || null : null;
      const fit = scoreConvocatoria({
        titulo,
        organismo,
        tipoConvocatoria: "Licitación pública",
        regiones: regions,
        presupuestoTotal: budget,
        fechaFinSolicitud: deadline,
        abierto: true,
        extraText: cpvLabel,
      });
      // Urban gardening / building maintenance noise: require a forest/nature signal in title or CPV.
      if (!topical(`${titulo} ${cpvLabel}`) || fit.score < MIN_SCORE + 5) continue;
      const orgN = normalizeText(organismo);
      const nivelAdmin: NivelAdmin = /ayuntamiento|ajuntament|concello|diputaci|cabildo|consell|mancomun|alcald|junta de gobierno/.test(orgN)
        ? "Local"
        : regions.length === 1 && !/confederacion|administrador de infraestructuras|estatal|ministerio|o\.a\./.test(orgN)
          ? "Autonómica"
          : "Estatal";
      items.push({
        id: `${id}:${pub}`,
        source: id,
        sourceLabel: "TED",
        kind: "licitacion",
        titulo,
        organismo,
        region,
        nivelAdmin,
        publishedAt: n["publication-date"]?.slice(0, 10) ?? null,
        opensAt: null,
        deadline,
        deadlineText: null,
        budget,
        amountText: budget ? `Valor estimado ${budget.toLocaleString("es-ES")} € (sin IVA)` : null,
        tipo: "Licitación pública",
        beneficiarios: [],
        url: `https://ted.europa.eu/es/notice/-/detail/${pub}`,
        basesUrl: null,
        documents: [{ name: "Anuncio TED (PDF)", description: cpvLabel || "Anuncio de licitación", url: `https://ted.europa.eu/es/notice/${pub}/pdf` }],
        summary: cpvLabel ? `Licitación publicada en TED · CPV: ${cpvLabel}.` : "Licitación publicada en TED.",
        fit,
      });
    }
    return {
      items,
      health: health(id, name, cat, "https://ted.europa.eu/es/", items.length,
        `API TED v3: ${json.totalNoticeCount ?? 0} anuncios forestales/ambientales en España (75 días), ${items.length} abiertos y relevantes.`),
    };
  } catch (e) {
    return errHealth(id, name, cat, "https://ted.europa.eu/es/", e);
  }
}

// ---------------------------------------------------------------- Fundación Montemadrid
export async function fetchMontemadrid(): Promise<Result> {
  const id = "montemadrid", name = "Fundación Montemadrid · Convocatorias", cat = "Fundación privada";
  const page = "https://www.fundacionmontemadrid.es/convocatorias/";
  try {
    const html = await (await get(page)).text();
    const items: Opportunity[] = [];
    let scanned = 0;
    for (const card of html.split(/<article class="call-card/).slice(1)) {
      const a = card.match(/<h3[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!a) continue;
      scanned++;
      const titulo = clean(a[2]);
      const status = clean(card.match(/<div class="card-badges[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "");
      const isOpen = /abierta|en plazo/i.test(status);
      const fit = scoreConvocatoria({
        titulo,
        organismo: "Fundación Montemadrid",
        tipoConvocatoria: "Convocatoria fundación privada",
        abierto: isOpen,
        regiones: ["Comunidad de Madrid"],
      });
      if (!topical(titulo) || fit.score < MIN_SCORE) continue;
      const url = new URL(a[1], page).toString();
      items.push({
        id: `${id}:${a[1].replace(/^.*\/convocatorias\//, "")}`,
        source: id,
        sourceLabel: "Fundación Montemadrid",
        kind: "empresa",
        titulo,
        organismo: "Fundación Montemadrid",
        region: "Comunidad de Madrid",
        nivelAdmin: "Privada",
        publishedAt: null,
        opensAt: null,
        deadline: null,
        deadlineText: status ? `Estado en la web: ${status}${isOpen ? "" : " (convocatoria periódica: preparar la próxima edición)"}` : null,
        budget: null,
        amountText: null,
        tipo: "Convocatoria fundación privada",
        beneficiarios: [],
        url,
        basesUrl: null,
        documents: [],
        summary: "Convocatoria pública de Fundación Montemadrid (Madrid). Revisar bases y fechas en la página oficial.",
        fit,
      });
    }
    return {
      items,
      health: health(id, name, cat, page, items.length,
        `${scanned} convocatorias publicadas en la web, ${items.length} con encaje ambiental.`),
    };
  } catch (e) {
    return errHealth(id, name, cat, page, e);
  }
}

export async function getExtraSources(): Promise<{ items: Opportunity[]; health: SourceHealth[] }> {
  const results = await Promise.all([fetchBoja(), fetchBocyl(), fetchTed(), fetchMontemadrid()]);
  return {
    items: results.flatMap((r) => r.items),
    health: results.map((r) => r.health),
  };
}
