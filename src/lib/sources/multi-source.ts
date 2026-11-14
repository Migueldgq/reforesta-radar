import { deadlineFromDays, extractNoticeDetails, isCallNotice, isOpenTender, parseDeadline } from "../boe";
import { decodeHtml, esDateToIso, fetchJson, fetchText, mapLimit, toIsoDate } from "../http";
import type { Opportunity } from "../opportunity";
import { normalizeText, scoreConvocatoria, tierFor } from "../scoring";
import type { ExternalSourceItem, SourceHealth } from "../types";

type SourceResult = { items: Opportunity[]; health: SourceHealth };

function baseOpp(partial: Partial<Opportunity> & Pick<Opportunity, "id" | "source" | "sourceLabel" | "kind" | "titulo" | "organismo" | "region" | "nivelAdmin" | "url" | "fit">): Opportunity {
  return {
    publishedAt: null,
    opensAt: null,
    deadline: null,
    deadlineText: null,
    budget: null,
    amountText: null,
    tipo: null,
    beneficiarios: [],
    basesUrl: null,
    documents: [],
    summary: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// 1. EU Funding & Tenders (SEDIA search API): LIFE + nature/forest topics
// ---------------------------------------------------------------------------

const SEDIA_URL = "https://api.tech.ec.europa.eu/search-api/prod/rest/search";
const LIFE_ID = "43252405";
const HORIZON_ID = "43108390";

interface SediaResult {
  url?: string;
  metadata?: Record<string, string[] | undefined>;
}

async function sediaSearch(text: string, programme: string | null, pageSize: number): Promise<SediaResult[] | null> {
  const must: unknown[] = [
    { terms: { type: ["1", "2", "8"] } },
    { terms: { status: ["31094501", "31094502"] } },
  ];
  if (programme) must.push({ terms: { frameworkProgramme: [programme] } });
  const form = new FormData();
  form.append("query", new Blob([JSON.stringify({ bool: { must } })], { type: "application/json" }));
  form.append("languages", new Blob([JSON.stringify(["en"])], { type: "application/json" }));
  form.append("sort", new Blob([JSON.stringify({ field: "deadlineDate", order: "DESC" })], { type: "application/json" }));
  const json = await fetchJson<{ results?: SediaResult[] }>(
    `${SEDIA_URL}?apiKey=SEDIA&text=${encodeURIComponent(text)}&pageSize=${pageSize}&pageNumber=1`,
    { method: "POST", body: form, timeoutMs: 18000 }
  );
  return json?.results ?? null;
}

// English topic terms -> Spanish equivalents understood by the scorer
const EN_TOPIC: [RegExp, string][] = [
  [/\bbiodiversit/, "biodiversidad"],
  [/\bforest/, "forestal bosque"],
  [/\b(re|af)forest/, "reforestacion"],
  [/\bnature restoration|\becosystem restoration|\brestor(e|ation) (of )?(ecosystems|habitats|nature)/, "restauracion ecologica"],
  [/\bnature\b|\bnatural capital/, "medio natural"],
  [/\becosystem/, "ecosistema"],
  [/\bhabitat/, "habitat"],
  [/\binvasive (alien )?species/, "especies invasoras"],
  [/\bwetland/, "humedal"],
  [/\bpollinat/, "polinizador"],
  [/\bagroforest/, "agroforestal"],
  [/\bbirds?\b/, "avifauna"],
  [/\bclimate (change )?adaptation/, "cambio climatico"],
  [/\bnature-based solution/, "soluciones basadas en la naturaleza"],
  [/\benvironmental education|\bcitizen science/, "educacion ambiental"],
  [/\bnatura 2000/, "red natura"],
];
const EU_OFFTOPIC = /\b(space|aircraft|batter|hydrogen|semiconductor|quantum|cyber|terroris|vehicle|hydropower|pv |photovoltaic|ccus|grid|microbiome|livestock|aquatic food|footwear|plastic|construction|electronics|dementia|migration|labour|heritage|creative|ai-powered|artificial intelligence|antarctica|food system|protective gear|disaster|smuggled|police|policing)/;

function nextFutureDeadline(list: string[] | undefined): string | null {
  const today = toIsoDate(new Date());
  const future = (list ?? []).map((d) => d.slice(0, 10)).filter((d) => d >= today).sort();
  return future[0] ?? null;
}

export async function scrapeEu(): Promise<SourceResult> {
  const portal = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals";
  const queries: [string, string | null][] = [
    ["***", LIFE_ID],
    ["forest", null],
    ["biodiversity restoration", null],
    ["nature restoration", HORIZON_ID],
    ["invasive species", null],
  ];
  const results = await Promise.all(queries.map(([t, p]) => sediaSearch(t, p, 100)));
  const okCount = results.filter((r) => r !== null).length;
  const seen = new Set<string>();
  const items: Opportunity[] = [];

  for (const r of results.flat()) {
    if (!r?.metadata) continue;
    const m = r.metadata;
    const identifier = m.identifier?.[0] || m.callIdentifier?.[0] || "";
    if (!identifier || seen.has(identifier) || identifier.endsWith("-CANCELLED")) continue;
    const deadline = nextFutureDeadline(m.deadlineDate);
    if (!deadline) continue; // all deadlines past
    const programme = m.frameworkProgramme?.[0] === LIFE_ID ? "LIFE" : m.frameworkProgramme?.[0] === HORIZON_ID ? "Horizon Europe" : "UE";
    const title = decodeHtml(m.title?.[0] || m.callTitle?.[0] || identifier);
    const description = decodeHtml(m.description?.[0] || m.descriptionByte?.[0] || "").slice(0, 2000);
    const enText = `${title} ${description}`.toLowerCase();
    const isLife = programme === "LIFE";
    if (!isLife && EU_OFFTOPIC.test(title.toLowerCase())) continue;
    const esTerms = EN_TOPIC.filter(([re]) => re.test(title.toLowerCase())).map(([, es]) => es);
    const esDescTerms = EN_TOPIC.filter(([re]) => re.test(enText)).map(([, es]) => es);
    if (!isLife && esTerms.length === 0) continue; // title must be on-topic for non-LIFE
    seen.add(identifier);

    const fit = scoreConvocatoria({
      titulo: esTerms.join(" ") || title,
      organismo: `Comisión Europea · ${programme}`,
      tipoConvocatoria: "Concurrencia competitiva (UE)",
      fechaInicioSolicitud: m.startDate?.[0]?.slice(0, 10) ?? null,
      fechaFinSolicitud: deadline,
      extraText: esDescTerms.join(" "),
      kind: "europa",
    });
    if (programme === "Horizon Europe") {
      fit.score = Math.min(58, Math.max(0, fit.score - 12));
      fit.tier = tierFor(fit.score);
      fit.warnings.push("Horizon Europe: proyecto de investigación en consorcio internacional; Reforesta encajaría como socio de demostración, no como líder.");
    } else if (isLife) {
      fit.reasons.unshift("Programa LIFE: el instrumento europeo de referencia para naturaleza y biodiversidad.");
    }
    if (/municipalit|local authorit|cities\b/.test(title.toLowerCase())) {
      fit.warnings.push("Dirigida principalmente a municipios / autoridades locales.");
    }
    const budget = Number(m.budget?.[0]);
    const type = m.type?.[0];
    const url =
      type === "8" && m.url?.[0]
        ? m.url[0]
        : `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${identifier.toLowerCase()}`;

    items.push(
      baseOpp({
        id: `eu:${identifier}`,
        source: "eu",
        sourceLabel: isLife ? "UE · LIFE" : `UE · ${programme}`,
        kind: "europa",
        titulo: title,
        organismo: `Comisión Europea · ${programme} (${identifier})`,
        region: "Unión Europea",
        nivelAdmin: "UE",
        opensAt: m.startDate?.[0]?.slice(0, 10) ?? null,
        deadline,
        budget: Number.isFinite(budget) && budget > 0 ? budget : null,
        tipo: "Convocatoria UE (concurrencia competitiva)",
        beneficiarios: [],
        url,
        summary: description ? description.slice(0, 400) : null,
        fit,
      })
    );
  }

  return {
    items,
    health: {
      id: "eu",
      name: "UE · Funding & Tenders (LIFE, Horizon)",
      category: "Portal UE",
      status: okCount === 0 ? "error" : okCount < queries.length ? "partial" : "ok",
      count: items.length,
      url: portal,
      note:
        items.length === 0 && okCount > 0
          ? "API SEDIA OK, pero ninguna convocatoria LIFE/naturaleza con plazo futuro en este momento."
          : `API SEDIA oficial: ${queries.length} búsquedas (LIFE + bosques/biodiversidad/restauración), solo con plazo futuro.`,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. BOCM (Comunidad de Madrid): daily XML summaries, walking back ~3 weeks
// ---------------------------------------------------------------------------

const BOCM_DAYS = 21;

function bocmXmlUrl(d: Date, num: number): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `https://www.bocm.es/boletin/CM_Boletin_BOCM/${y}/${m}/${day}/BOCM-${y}${m}${day}${num}.xml`;
}

interface NoticeCandidate {
  id: string;
  fecha: string;
  organismo: string;
  titulo: string;
  url: string;
  pdfUrl: string | null;
  licitacion: boolean;
}

function parseBocmXml(xml: string, fecha: string): NoticeCandidate[] {
  const out: NoticeCandidate[] = [];
  const orgRe = /<organismo\s+nombre="([^"]+)">([\s\S]*?)<\/organismo>/g;
  let om: RegExpExecArray | null;
  while ((om = orgRe.exec(xml)) !== null) {
    const organismo = decodeHtml(om[1]);
    const dispRe = /<disposicion[^>]*>([\s\S]*?)<\/disposicion>/g;
    let dm: RegExpExecArray | null;
    while ((dm = dispRe.exec(om[2])) !== null) {
      const block = dm[1];
      const id = block.match(/<identificador>([^<]+)<\/identificador>/)?.[1]?.trim();
      const titulo = decodeHtml(block.match(/<titulo>([\s\S]*?)<\/titulo>/)?.[1] ?? "");
      if (!id || !titulo) continue;
      const t = normalizeText(titulo);
      const licitacion = isOpenTender(t);
      if (!licitacion && !isCallNotice(t)) continue;
      out.push({
        id,
        fecha,
        organismo,
        titulo: titulo.replace(/^[^–]{0,80}–\s*/, ""), // drop the short heading before "–"
        url: block.match(/<url_html>([^<]+)<\/url_html>/)?.[1]?.trim() || `https://www.bocm.es/${id.toLowerCase()}`,
        pdfUrl: block.match(/<url_pdf>([^<]+)<\/url_pdf>/)?.[1]?.trim() || null,
        licitacion,
      });
    }
  }
  return out;
}

export async function scrapeBocm(): Promise<SourceResult> {
  const home = "https://www.bocm.es/";
  const health = (status: SourceHealth["status"], count: number, note: string): SourceHealth => ({
    id: "bocm",
    name: "BOCM · Comunidad de Madrid",
    category: "Boletín Oficial",
    status,
    count,
    url: home,
    note,
  });
  const html = await fetchText(home, { timeoutMs: 9000 });
  const latest = html?.match(/\/boletin\/CM_Boletin_BOCM\/(\d{4})\/(\d{2})\/(\d{2})\/BOCM-\d{8}(\d+)\.xml/);
  if (!latest) return { items: [], health: health("error", 0, "No se encontró el sumario XML del último BOCM.") };

  let date = new Date(Number(latest[1]), Number(latest[2]) - 1, Number(latest[3]));
  let num = Number(latest[4]);
  const xmls: { xml: string; fecha: string }[] = [];
  const first = await fetchText(bocmXmlUrl(date, num), { timeoutMs: 9000 });
  if (first) xmls.push({ xml: first, fecha: toIsoDate(date) });

  // Walk back: each publication day decrements the issue number by 1 (Sundays have no issue).
  let misses = 0;
  for (let i = 1; i <= BOCM_DAYS && misses < 4; i++) {
    date = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    const xml = await fetchText(bocmXmlUrl(date, num - 1), { timeoutMs: 6000 });
    if (xml) {
      num -= 1;
      misses = 0;
      xmls.push({ xml, fecha: toIsoDate(date) });
    } else {
      misses++;
    }
  }

  const candidates = xmls.flatMap(({ xml, fecha }) => parseBocmXml(xml, fecha)).slice(0, 140);

  // BOCM titles are often generic ("Móstoles. Régimen económico. Extracto convocatoria subvenciones"),
  // so read every candidate's page and use the real "Extracto ... por el que se convoca ..." sentence.
  const enriched = await mapLimit(candidates, 6, async (c) => {
    const page = await fetchText(c.url, { timeoutMs: 8000 });
    const text = page ? decodeHtml(page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")) : "";
    const startIdx = Math.max(0, text.search(/Extracto (?:de |del )|Anuncio de licitaci|Objeto del contrato|por (?:el|la) que se (?:convoca|anuncia)/i));
    const body = text.slice(startIdx, startIdx + 15000);
    const det = extractNoticeDetails(body);
    const extracto = body.match(/^(Extracto (?:de |del )[^]{20,380}?)(?:\.\s+(?:BDNS|De conformidad)|\s+BDNS\b)/i)?.[1];
    const generic = !c.licitacion && /R[ée]gimen econ[óo]mico|^Extracto convocatoria/i.test(c.titulo);
    const titulo = (generic && extracto ? `${c.titulo.split(".")[0]}. ${extracto}` : c.titulo).trim();
    const explicit = parseDeadline(det.deadlineText);
    const deadline = explicit ?? deadlineFromDays(c.fecha, det.deadlineText);
    const local = /R[ée]gimen econ[óo]mico/i.test(c.titulo) || /ayuntamiento/i.test(c.organismo);
    const fit = scoreConvocatoria({
      titulo,
      organismo: c.organismo,
      region: "Comunidad de Madrid",
      tipoConvocatoria: c.licitacion ? "Licitación pública" : /concurrencia competitiva/i.test(body) ? "Concurrencia competitiva" : "Convocatoria (BOCM)",
      extraText: det.summary ?? "",
      fechaInicioSolicitud: c.fecha,
      fechaFinSolicitud: deadline,
      kind: c.licitacion ? "licitacion" : "boletin",
    });
    if (deadline && !explicit) fit.warnings.push("Fecha límite estimada a partir del plazo en días: confirmar en el texto oficial.");
    return baseOpp({
      id: `bocm:${c.id}`,
      source: "bocm",
      sourceLabel: c.licitacion ? "BOCM · Licitación" : "BOCM",
      kind: c.licitacion ? "licitacion" : "boletin",
      titulo,
      organismo: c.organismo,
      region: "Comunidad de Madrid",
      nivelAdmin: local ? "Local" : "Autonómica",
      publishedAt: c.fecha,
      deadline,
      deadlineText: det.deadlineText,
      tipo: c.licitacion ? "Licitación pública" : "Convocatoria / extracto",
      url: c.url,
      documents: c.pdfUrl ? [{ name: `${c.id}.pdf`, description: "Texto oficial (PDF)", url: c.pdfUrl }] : [],
      summary: det.summary,
      fit,
    });
  });
  const items = enriched.filter((o) => o.fit.workLines.length > 0 && o.fit.score >= 35);

  return {
    items,
    health: health(
      "ok",
      items.length,
      `Sumarios XML oficiales de ${xmls.length} boletines (últimos ${BOCM_DAYS} días): ${candidates.length} convocatorias/licitaciones, ${items.length} con encaje ambiental.`
    ),
  };
}

// ---------------------------------------------------------------------------
// 3. DOG (Diario Oficial de Galicia): sections I-III and VI, last ~6 weeks
// ---------------------------------------------------------------------------

const DOG_DAYS = 45;

export async function scrapeDog(): Promise<SourceResult> {
  const portal = "https://www.xunta.gal/diario-oficial-galicia";
  const pages: { url: string; fecha: string }[] = [];
  for (let i = 0; i < DOG_DAYS; i++) {
    const d = new Date(Date.now() - i * 86400000);
    if (d.getDay() === 0 || d.getDay() === 6) continue; // DOG publishes Mon-Fri
    const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    for (const s of [1, 3]) {
      pages.push({ url: `https://www.xunta.gal/dog/Publicados/${d.getFullYear()}/${key}/Secciones${s}_es.html`, fecha: toIsoDate(d) });
    }
  }
  const htmls = await mapLimit(pages, 6, (p) => fetchText(p.url, { timeoutMs: 8000 }));
  const okPages = htmls.filter(Boolean).length;

  const candidates: NoticeCandidate[] = [];
  const seen = new Set<string>();
  htmls.forEach((html, idx) => {
    if (!html) return;
    const { fecha } = pages[idx];
    // walk the TOC in order so each entry gets the last organism heading seen
    const tokenRe = /<p class="dog-toc-organismo">([\s\S]*?)<\/p>|<li class="dog-toc-sumario"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let organismo = "Xunta de Galicia";
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(html)) !== null) {
      if (m[1] !== undefined) {
        organismo = decodeHtml(m[1]);
        continue;
      }
      const href = m[2];
      const titulo = decodeHtml(m[3]);
      if (seen.has(href) || titulo.length < 20) continue;
      const t = normalizeText(titulo);
      const licitacion = isOpenTender(t);
      if (!licitacion && !isCallNotice(t)) continue;
      seen.add(href);
      const url = `https://www.xunta.gal${href}`;
      candidates.push({
        id: href.split("/").pop()?.replace(/\.html$/, "") || href,
        fecha,
        organismo,
        titulo,
        url,
        pdfUrl: url.replace(/\.html$/i, ".pdf"),
        licitacion,
      });
    }
  });

  const relevant = candidates
    .map((c) => ({
      c,
      fit: scoreConvocatoria({
        titulo: c.titulo,
        organismo: c.organismo,
        region: "Galicia",
        tipoConvocatoria: c.licitacion ? "Licitación pública" : "Convocatoria (DOG)",
        kind: c.licitacion ? "licitacion" : "boletin",
      }),
    }))
    .filter(({ fit }) => fit.workLines.length > 0 && fit.score >= 35);

  const items = await mapLimit(relevant, 5, async ({ c }) => {
    const page = await fetchText(c.url, { timeoutMs: 8000 });
    const det = page ? extractNoticeDetails(decodeHtml(page).slice(0, 20000)) : { deadlineText: null, summary: null };
    const explicit = parseDeadline(det.deadlineText);
    const deadline = explicit ?? deadlineFromDays(c.fecha, det.deadlineText);
    const fit = scoreConvocatoria({
      titulo: c.titulo,
      organismo: c.organismo,
      region: "Galicia",
      tipoConvocatoria: c.licitacion ? "Licitación pública" : "Convocatoria (DOG)",
      extraText: det.summary ?? "",
      fechaInicioSolicitud: c.fecha,
      fechaFinSolicitud: deadline,
      kind: c.licitacion ? "licitacion" : "boletin",
    });
    if (deadline && !explicit) fit.warnings.push("Fecha límite estimada a partir del plazo en días: confirmar en el texto oficial.");
    return baseOpp({
      id: `dog:${c.id}`,
      source: "dog",
      sourceLabel: c.licitacion ? "DOG · Licitación" : "DOG",
      kind: c.licitacion ? "licitacion" : "boletin",
      titulo: c.titulo,
      organismo: c.organismo,
      region: "Galicia",
      nivelAdmin: "Autonómica",
      publishedAt: c.fecha,
      deadline,
      deadlineText: det.deadlineText,
      tipo: c.licitacion ? "Licitación pública" : "Convocatoria / bases",
      url: c.url,
      documents: c.pdfUrl ? [{ name: `${c.id}.pdf`, description: "Texto oficial (PDF)", url: c.pdfUrl }] : [],
      summary: det.summary,
      fit,
    });
  });

  return {
    items,
    health: {
      id: "dog",
      name: "DOG · Diario Oficial de Galicia",
      category: "Boletín Oficial",
      status: okPages === 0 ? "error" : "ok",
      count: items.length,
      url: portal,
      note: `${okPages} sumarios (secciones I-III y VI, últimos ${DOG_DAYS} días): ${candidates.length} convocatorias/licitaciones, ${items.length} con encaje ambiental.`,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Fundación Biodiversidad: "buscador de convocatorias" + each detail page
// ---------------------------------------------------------------------------

const FB_SEARCH = "https://fundacion-biodiversidad.es/buscador-de-convocatorias/";

function parseAmount(s: string | undefined): number | null {
  if (!s) return null;
  const n = normalizeText(s);
  const mill = n.match(/([\d.,]+)\s*millones/);
  if (mill) return Math.round(Number(mill[1].replace(/\./g, "").replace(",", ".")) * 1_000_000);
  const eur = n.match(/([\d.]+(?:,\d+)?)\s*(?:€|euros)/);
  if (eur) return Math.round(Number(eur[1].replace(/\./g, "").replace(",", ".")));
  return null;
}

export async function scrapeFundacionBiodiversidad(): Promise<SourceResult> {
  const listPages = await Promise.all([FB_SEARCH, `${FB_SEARCH}?sf_paged=2`].map((u) => fetchText(u, { timeoutMs: 10000 })));
  const links: { url: string; title: string; excerpt: string }[] = [];
  const seen = new Set<string>();
  for (const html of listPages) {
    if (!html) continue;
    const re = /<div class="intro-ficha">\s*<h2><a href="([^"]+)">([\s\S]*?)<\/a><\/h2>([\s\S]*?)<a class="link-ver-mas-ficha"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      links.push({ url: m[1], title: decodeHtml(m[2]), excerpt: decodeHtml(m[3]).replace(/\s*\[…\]\s*$/, "…") });
    }
  }
  if (links.length === 0) {
    return {
      items: [],
      health: { id: "fb", name: "Fundación Biodiversidad", category: "Web oficial", status: "error", count: 0, url: FB_SEARCH, note: "No se pudo leer el buscador de convocatorias." },
    };
  }

  const items = await mapLimit(links, 6, async (l) => {
    const page = await fetchText(l.url, { timeoutMs: 10000 });
    const text = page ? decodeHtml(page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")) : "";
    const status = text.match(/Convocatoria (abierta|cerrada|resuelta|pr[oó]xima)/i)?.[1]?.toLowerCase() ?? null;
    const start = esDateToIso(text.match(/Fecha [Ii]nicio:\s*([\d/]+)/)?.[1]);
    const end = esDateToIso(text.match(/Fecha fin:\s*([\d/]+)/)?.[1]);
    const totalTxt = text.match(/Importe total de la convocatoria:\s*([^:]{3,60}?)(?=\s+(?:Importe|Fuente|Correo|Año|$))/)?.[1]?.trim();
    const perProject = text.match(/Importe por proyecto:\s*([^:]{3,80}?)(?=\s+(?:Importe|Fuente|Correo|Año|$))/)?.[1]?.trim();
    const isBeca = /\bbecas?\b/i.test(l.title);

    const fit = scoreConvocatoria({
      titulo: l.title,
      organismo: "Fundación Biodiversidad (MITECO)",
      tipoConvocatoria: /concurrencia competitiva/i.test(l.excerpt) ? "Concurrencia competitiva" : "Convocatoria pública",
      extraText: l.excerpt,
      fechaInicioSolicitud: start,
      fechaFinSolicitud: end,
      abierto: status === "abierta" ? true : status ? false : undefined,
      kind: "subvencion",
    });
    if (!end && status && status !== "abierta" && status !== "próxima" && status !== "proxima") {
      fit.deadlineState = "cerrada";
      fit.score = Math.min(fit.score, 50);
      fit.tier = tierFor(fit.score);
    }
    return {
      opp: baseOpp({
        id: `fb:${l.url.replace(/\/$/, "").split("/").pop()}`,
        source: "fb",
        sourceLabel: "F. Biodiversidad",
        kind: "subvencion",
        titulo: l.title,
        organismo: "Fundación Biodiversidad (MITECO)",
        region: "Estatal",
        nivelAdmin: "Estatal",
        opensAt: start,
        deadline: end,
        deadlineText: status ? `Convocatoria ${status}` : null,
        budget: parseAmount(totalTxt),
        amountText: [totalTxt && `Total: ${totalTxt}`, perProject && `Por proyecto: ${perProject}`].filter(Boolean).join(" · ") || null,
        tipo: /concurrencia competitiva/i.test(l.excerpt) ? "Concurrencia competitiva" : "Convocatoria pública",
        url: l.url,
        summary: l.excerpt || null,
        fit,
      }),
      isBeca,
    };
  });

  const kept = items.filter((i) => !i.isBeca).map((i) => i.opp);
  const open = kept.filter((o) => o.fit.deadlineState === "abierta" || o.fit.deadlineState === "proxima").length;
  return {
    items: kept,
    health: {
      id: "fb",
      name: "Fundación Biodiversidad",
      category: "Web oficial",
      status: "ok",
      count: kept.length,
      url: FB_SEARCH,
      note: `Buscador oficial (2 páginas) + ficha de cada convocatoria: ${kept.length} convocatorias, ${open} abiertas o próximas (el resto se muestran cerradas como referencia).`,
    },
  };
}

// ---------------------------------------------------------------------------

export async function getExternalRadar(): Promise<SourceResult[]> {
  const wrap = async (id: string, name: string, fn: () => Promise<SourceResult>): Promise<SourceResult> => {
    try {
      return await fn();
    } catch (err) {
      return {
        items: [],
        health: { id, name, category: "Otros", status: "error", count: 0, url: "", note: `Error inesperado: ${(err as Error).message}` },
      };
    }
  };
  return Promise.all([
    wrap("eu", "UE · Funding & Tenders", scrapeEu),
    wrap("bocm", "BOCM · Comunidad de Madrid", scrapeBocm),
    wrap("dog", "DOG · Diario Oficial de Galicia", scrapeDog),
    wrap("fb", "Fundación Biodiversidad", scrapeFundacionBiodiversidad),
  ]);
}

// Legacy shape for /api/fuentes
const LEGACY_SOURCE_ID: Record<string, ExternalSourceItem["sourceId"]> = {
  eu: "eu-life",
  bocm: "bocm",
  dog: "dog",
  fb: "fundacion-biodiversidad",
};

export async function getAllExternalSources(): Promise<{
  items: ExternalSourceItem[];
  sourcesStatus: SourceHealth[];
  fetchedAt: string;
}> {
  const results = await getExternalRadar();
  const items: ExternalSourceItem[] = results
    .flatMap((r) => r.items)
    .map((o) => ({
      id: o.id,
      sourceId: LEGACY_SOURCE_ID[o.source] ?? "bocm",
      sourceLabel: o.sourceLabel,
      region: o.region,
      date: o.deadline || o.publishedAt || "Sin fecha",
      organismo: o.organismo,
      titulo: o.titulo,
      url: o.url,
      pdfUrl: o.documents[0]?.url ?? null,
      fit: o.fit,
    }))
    .sort((a, b) => b.fit.score - a.fit.score);
  return { items, sourcesStatus: results.map((r) => r.health), fetchedAt: new Date().toISOString() };
}

