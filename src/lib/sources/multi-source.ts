import { normalizeText, scoreConvocatoria } from "../scoring";
import type { ExternalSourceItem, SourceHealth } from "../types";

const ENV_TERMS = [
  "reforest",
  "forestal",
  "silvic",
  "restaurac",
  "biodivers",
  "medio ambiente",
  "medioambiente",
  "medioambient",
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
  "custodia",
  "invasoras",
  "agroambiental",
  "nature",
  "climate",
  "life",
  "subvencions",
  "subvencion",
  "entidades sen fins de lucro",
  "entidades sin animo",
];

function isRelevant(text: string): boolean {
  const norm = normalizeText(text);
  return ENV_TERMS.some((t) => norm.includes(t));
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 1. EU Funding & Tenders Portal + LIFE Programme
async function scrapeEuLife(): Promise<{
  items: ExternalSourceItem[];
  health: SourceHealth;
}> {
  const portalUrl = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-search";
  try {
    const res = await fetch(
      "https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=biodiversity%20OR%20reforestation%20OR%20LIFE&pageSize=15&pageNumber=1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 ReforestaRadar/1.0",
        },
        body: JSON.stringify({
          bool: {
            must: [
              { terms: { type: ["1", "2", "8"] } },
              { terms: { status: ["31094501", "31094502"] } },
            ],
          },
        }),
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      results?: {
        reference?: string;
        url?: string;
        language?: string;
        summary?: string;
        metadata?: {
          title?: string[];
          identifier?: string[];
          deadlineDate?: string[];
          frameworkProgramme?: string[];
        };
      }[];
    };

    const seenIdentifiers = new Set<string>();
    const items: ExternalSourceItem[] = [];

    for (const r of json.results ?? []) {
      const identifier =
        r.metadata?.identifier?.[0] || r.reference || r.url || "";
      if (!identifier || seenIdentifiers.has(identifier)) continue;
      // Prefer English version when available
      if (r.language && r.language !== "en") continue;
      seenIdentifiers.add(identifier);

      const title = r.metadata?.title?.[0] || r.summary || identifier;
      const deadlineRaw = r.metadata?.deadlineDate?.[0] || null;
      const deadline = deadlineRaw ? deadlineRaw.slice(0, 10) : "Abierta / Próxima";
      const programme = r.metadata?.frameworkProgramme?.[0] || "UE Funding & Tenders / LIFE";

      const fit = scoreConvocatoria({
        titulo: title,
        organismo: `Comisión Europea · ${programme}`,
        tipoConvocatoria: "Concurrencia competitiva UE",
        fechaFinSolicitud: deadlineRaw ? deadlineRaw.slice(0, 10) : null,
        abierto: true,
        extraText: "restauracion biodiversidad ecosistemas reforestacion",
      });

      const webUrl = `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${encodeURIComponent(
        identifier.toLowerCase()
      )}`;

      items.push({
        id: `eu-${identifier}`,
        sourceId: "eu-life",
        sourceLabel: "UE · LIFE / Funding & Tenders",
        region: "Unión Europea",
        date: deadline,
        organismo: `Comisión Europea (${identifier})`,
        titulo: title,
        url: webUrl,
        pdfUrl: null,
        fit,
      });
    }

    return {
      items: items.slice(0, 12),
      health: {
        id: "eu-life",
        name: "UE Funding & Tenders / LIFE",
        category: "Portal UE",
        status: "ok",
        count: items.slice(0, 12).length,
        url: portalUrl,
        note: "API SEDIA oficial de la Comisión Europea (convocatorias abiertas/próximas).",
      },
    };
  } catch {
    return {
      items: [],
      health: {
        id: "eu-life",
        name: "UE Funding & Tenders / LIFE",
        category: "Portal UE",
        status: "error",
        count: 0,
        url: portalUrl,
        note: "No se pudo conectar con la API de la UE.",
      },
    };
  }
}

// 2. BOCM (Boletín Oficial de la Comunidad de Madrid) via official XML summaries
async function scrapeBocm(): Promise<{
  items: ExternalSourceItem[];
  health: SourceHealth;
}> {
  const baseUrl = "https://www.bocm.es/";
  try {
    const homeRes = await fetch(baseUrl, {
      headers: { "User-Agent": "Mozilla/5.0 ReforestaRadar/1.0" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!homeRes.ok) throw new Error(`HTTP ${homeRes.status}`);
    const html = await homeRes.text();

    const xmlMatches = Array.from(
      new Set(
        Array.from(
          html.matchAll(
            /\/boletin\/CM_Boletin_BOCM\/\d{4}\/\d{2}\/\d{2}\/BOCM-\d+\.xml/g
          )
        ).map((m) => `https://www.bocm.es${m[0]}`)
      )
    ).slice(0, 3);

    if (xmlMatches.length === 0) {
      throw new Error("No se encontró XML del último BOCM");
    }

    const items: ExternalSourceItem[] = [];
    let latestDate = "Último BOCM";

    for (const xmlUrl of xmlMatches) {
      const xmlRes = await fetch(xmlUrl, {
        headers: { "User-Agent": "Mozilla/5.0 ReforestaRadar/1.0" },
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
      });
      if (!xmlRes.ok) continue;
      const xml = await xmlRes.text();

      const dateMatch = xml.match(
        /<fecha_publicacion>([^<]+)<\/fecha_publicacion>/
      );
      const pubDate = dateMatch?.[1] || "BOCM";
      if (latestDate === "Último BOCM") latestDate = pubDate;

      const orgBlocks = xml.split(/<organismo\s+nombre="([^"]+)">/);

      for (let i = 1; i < orgBlocks.length; i += 2) {
        const organismo = decodeHtmlEntities(orgBlocks[i]);
        const body = orgBlocks[i + 1] || "";
        const dispRegex =
          /<disposicion[^>]*>[\s\S]*?<identificador>([^<]+)<\/identificador>[\s\S]*?<titulo>([\s\S]*?)<\/titulo>[\s\S]*?(?:<url_pdf>([^<]*)<\/url_pdf>)?[\s\S]*?(?:<url_html>([^<]*)<\/url_html>)?[\s\S]*?<\/disposicion>/g;

        let match: RegExpExecArray | null;
        while ((match = dispRegex.exec(body)) !== null) {
          const id = match[1].trim();
          const titulo = decodeHtmlEntities(match[2]);
          const pdfUrl = match[3]?.trim() || null;
          const htmlUrl = match[4]?.trim() || xmlUrl;

          if (!isRelevant(`${titulo} ${organismo}`)) continue;

          const fit = scoreConvocatoria({
            titulo,
            organismo,
            tipoConvocatoria: "BOCM · Boletín Oficial",
            abierto: true,
          });
          if (fit.score < 28) continue;

          items.push({
            id: `bocm-${id}`,
            sourceId: "bocm",
            sourceLabel: "BOCM Madrid",
            region: "Comunidad de Madrid",
            date: pubDate,
            organismo,
            titulo,
            url: htmlUrl,
            pdfUrl,
            fit,
          });
        }
      }
    }

    return {
      items: items.slice(0, 15),
      health: {
        id: "bocm",
        name: "BOCM (Comunidad de Madrid)",
        category: "Boletín Oficial",
        status: "ok",
        count: items.slice(0, 15).length,
        url: baseUrl,
        note: `Sumarios XML oficiales (desde ${latestDate}).`,
      },
    };
  } catch {
    return {
      items: [],
      health: {
        id: "bocm",
        name: "BOCM (Comunidad de Madrid)",
        category: "Boletín Oficial",
        status: "error",
        count: 0,
        url: baseUrl,
        note: "No se pudo leer el sumario XML del BOCM.",
      },
    };
  }
}

// 3. DOG (Diario Oficial de Galicia) via official summary HTML
async function scrapeDog(): Promise<{
  items: ExternalSourceItem[];
  health: SourceHealth;
}> {
  const dogUrl = "https://www.xunta.gal/diario-oficial-galicia";
  try {
    const homeRes = await fetch(dogUrl, {
      headers: { "User-Agent": "Mozilla/5.0 ReforestaRadar/1.0" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!homeRes.ok) throw new Error(`HTTP ${homeRes.status}`);
    const html = await homeRes.text();

    // Extract Secciones1 (Otras disposiciones) & Secciones3 (Anuncios)
    const sectionMatches = Array.from(
      html.matchAll(/ruta=(\/\d{4}\/\d{8}\/Secciones[13]_gl\.html)/g)
    ).map((m) => m[1]);

    const uniquePaths = Array.from(new Set(sectionMatches)).slice(0, 2);
    const items: ExternalSourceItem[] = [];

    for (const relPath of uniquePaths) {
      const secUrl = `https://www.xunta.gal/diario-oficial-galicia/mostrarContenido.do?paginaCompleta=false&idEstado=5&rutaRelativa=true&ruta=${relPath}`;
      const secRes = await fetch(secUrl, {
        headers: { "User-Agent": "Mozilla/5.0 ReforestaRadar/1.0" },
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
      });
      if (!secRes.ok) continue;
      const secHtml = await secRes.text();

      const dateMatch = relPath.match(/\/(\d{4})(\d{2})(\d{2})\//);
      const dateStr = dateMatch
        ? `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`
        : "Último DOG";

      const linkRegex =
        /<a[^>]*href="([^"]*Anuncio[^"]*\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(secHtml)) !== null) {
        const href = m[1].startsWith("http")
          ? m[1]
          : `https://www.xunta.gal/dog/Publicados${m[1].startsWith("/") ? "" : "/"}${m[1]}`;
        const titulo = decodeHtmlEntities(m[2]);
        if (titulo.length < 20) continue;
        if (!isRelevant(titulo)) continue;

        const fit = scoreConvocatoria({
          titulo,
          organismo: "Xunta de Galicia / DOG",
          tipoConvocatoria: "DOG · Diario Oficial de Galicia",
          abierto: true,
        });
        if (fit.score < 28) continue;

        items.push({
          id: `dog-${items.length}-${dateStr}`,
          sourceId: "dog",
          sourceLabel: "DOG Galicia",
          region: "Galicia",
          date: dateStr,
          organismo: "Diario Oficial de Galicia (Xunta)",
          titulo,
          url: href,
          pdfUrl: href.replace(/\.html$/i, ".pdf"),
          fit,
        });
      }
    }

    return {
      items: items.slice(0, 15),
      health: {
        id: "dog",
        name: "DOG (Diario Oficial de Galicia)",
        category: "Boletín Oficial",
        status: "ok",
        count: items.slice(0, 15).length,
        url: dogUrl,
        note: "Secciones III (Disposiciones) y VI (Anuncios) del último DOG.",
      },
    };
  } catch {
    return {
      items: [],
      health: {
        id: "dog",
        name: "DOG (Diario Oficial de Galicia)",
        category: "Boletín Oficial",
        status: "error",
        count: 0,
        url: dogUrl,
        note: "No se pudo leer el sumario del DOG.",
      },
    };
  }
}

// 4. Fundación Biodiversidad (convocatorias page)
async function scrapeFundacionBiodiversidad(): Promise<{
  items: ExternalSourceItem[];
  health: SourceHealth;
}> {
  const url = "https://fundacion-biodiversidad.es/convocatorias/";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 ReforestaRadar/1.0" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const items: ExternalSourceItem[] = [];
    const seen = new Set<string>();
    const anchorRegex =
      /<a[^>]*href="(https:\/\/fundacion-biodiversidad\.es\/[^"]*convocatoria[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRegex.exec(html)) !== null) {
      const link = m[1];
      const title = decodeHtmlEntities(m[2]);
      if (title.length < 18 || seen.has(link)) continue;
      seen.add(link);

      const fit = scoreConvocatoria({
        titulo: title,
        organismo: "Fundación Biodiversidad (MITECO)",
        tipoConvocatoria: "Convocatoria pública",
        abierto: true,
      });

      items.push({
        id: `fb-${items.length}`,
        sourceId: "fundacion-biodiversidad",
        sourceLabel: "Fundación Biodiversidad",
        region: "Estatal / Nacional",
        date: "Vigente / Portal",
        organismo: "Fundación Biodiversidad (MITECO)",
        titulo: title,
        url: link,
        pdfUrl: null,
        fit,
      });
    }

    return {
      items: items.slice(0, 10),
      health: {
        id: "fundacion-biodiversidad",
        name: "Fundación Biodiversidad",
        category: "Web / RSS",
        status: "ok",
        count: items.slice(0, 10).length,
        url,
        note: "Portal oficial de convocatorias de Fundación Biodiversidad.",
      },
    };
  } catch {
    return {
      items: [],
      health: {
        id: "fundacion-biodiversidad",
        name: "Fundación Biodiversidad",
        category: "Web / RSS",
        status: "error",
        count: 0,
        url,
        note: "No se pudo consultar el portal de Fundación Biodiversidad.",
      },
    };
  }
}

let multiCache: {
  timestamp: number;
  items: ExternalSourceItem[];
  sourcesStatus: SourceHealth[];
} | null = null;

export async function getAllExternalSources(refresh = false): Promise<{
  items: ExternalSourceItem[];
  sourcesStatus: SourceHealth[];
  fetchedAt: string;
}> {
  if (!refresh && multiCache && Date.now() - multiCache.timestamp < 10 * 60 * 1000) {
    return {
      items: multiCache.items,
      sourcesStatus: multiCache.sourcesStatus,
      fetchedAt: new Date(multiCache.timestamp).toISOString(),
    };
  }

  const [eu, bocm, dog, fb] = await Promise.all([
    scrapeEuLife(),
    scrapeBocm(),
    scrapeDog(),
    scrapeFundacionBiodiversidad(),
  ]);

  const items = [...eu.items, ...bocm.items, ...dog.items, ...fb.items].sort(
    (a, b) => b.fit.score - a.fit.score
  );

  const sourcesStatus: SourceHealth[] = [
    eu.health,
    bocm.health,
    dog.health,
    fb.health,
  ];

  multiCache = { timestamp: Date.now(), items, sourcesStatus };

  return {
    items,
    sourcesStatus,
    fetchedAt: new Date(multiCache.timestamp).toISOString(),
  };
}
