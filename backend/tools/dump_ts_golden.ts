// Dumps function-level golden data from the TypeScript scoring, for backend/tests/test_parity_functions.py.
// Read-only with respect to src/: it only imports the TS modules and calls them.
//
// Run from the repo root (needs node_modules; the clock is frozen so daysRemaining is reproducible):
//   TZ=Europe/Madrid npx tsx backend/tools/dump_ts_golden.ts
// Input:  backend/tests/golden/oportunidades.json (a dump of GET /api/oportunidades)
// Output: backend/tests/golden/ts_functions.json.gz
import fs from "fs";
import path from "path";
import zlib from "zlib";

const NOW = process.env.GOLDEN_NOW ?? "2026-11-15T12:00:00+01:00";
const FIXED = Date.parse(NOW);
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXED);
    else super(...(args as [string]));
  }
  static now() {
    return FIXED;
  }
}
globalThis.Date = FrozenDate as unknown as DateConstructor;

async function main() {
  const { scoreConvocatoria, geographicFit, kindFit, scoreRsc, normalizeText } = await import("../../src/lib/scoring");
  const { inferComunidadAutonoma } = await import("../../src/lib/regions");
  const { contentHash, dedupeKey } = await import("../../src/lib/store-pg");
  const { RSC_OPPORTUNITIES } = await import("../../src/lib/rsc-opportunities");
  const P = await import("../../src/lib/reforesta-profile");
  const { SCORING_VERSION } = await import("../../src/lib/cache");

  const dir = path.join(__dirname, "..", "tests", "golden");
  const golden = JSON.parse(fs.readFileSync(path.join(dir, "oportunidades.json"), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = golden.items;

  // 1. scoreConvocatoria on inputs built from real items, in several variants to reach every branch.
  const score: { input: Record<string, unknown>; fit: unknown }[] = [];
  items.forEach((o, i) => {
    const base = {
      titulo: o.titulo,
      organismo: o.organismo,
      tipoConvocatoria: o.tipo,
      beneficiarios: o.beneficiarios,
      region: o.region,
      presupuestoTotal: o.budget,
      fechaInicioSolicitud: o.opensAt,
      fechaFinSolicitud: o.deadline,
      extraText: o.summary ?? "",
      kind: o.kind,
    };
    const variants: Record<string, unknown>[] = [
      base,
      { titulo: o.titulo, organismo: o.organismo },
      { ...base, fechaFinSolicitud: null, fechaInicioSolicitud: o.publishedAt, abierto: i % 2 === 0 },
      { ...base, kind: ["subvencion", "licitacion", "boletin", "europa", "empresa"][i % 5], region: "Comunidad de Madrid" },
    ];
    for (const input of variants) score.push({ input, fit: scoreConvocatoria(input as never) });
  });

  // 2. geographicFit + kindFit on every item, plus nivelAdmin/region permutations on a subset.
  const niveles = ["Estatal", "Autonómica", "Local", "UE", "Privada", "Otros"];
  const regions = ["Comunidad de Madrid", "Estatal", "Unión Europea", "Castilla y León", "Galicia", "Principado de Asturias", "Sin determinar", ""];
  const geo: { item: Record<string, unknown>; geo: unknown; kind: unknown }[] = [];
  const pushGeo = (item: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = geographicFit(item as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    geo.push({ item, geo: g, kind: kindFit({ ...(item as any), fit: g }) });
  };
  items.forEach((o, i) => {
    const fit = scoreConvocatoria(score[i * 4].input as never);
    const item = { region: o.region, nivelAdmin: o.nivelAdmin, organismo: o.organismo, kind: o.kind, titulo: o.titulo, fit };
    pushGeo(item);
    if (i % 9 === 0) for (const nivelAdmin of niveles) for (const region of regions) pushGeo({ ...item, nivelAdmin, region });
  });
  for (const organismo of ["AYUNTAMIENTO DE GETAFE · X", "Ayuntamiento del Real Sitio", "CONCELLO DE LUGO", "Diputación de Toledo", "UNIVERSIDAD DE VIGO"]) {
    for (const region of regions) {
      for (const kind of ["subvencion", "licitacion", "boletin", "europa"]) {
        const fit = scoreConvocatoria({ titulo: "Convocatoria de ayudas para reforestación", organismo, kind: kind as never });
        pushGeo({ region, nivelAdmin: "Local", organismo, kind, titulo: "Convocatoria de ayudas para reforestación", fit });
      }
    }
  }

  // 3. RSC fit, region inference, normalisation, hashes.
  const rsc = RSC_OPPORTUNITIES.map((r) => ({ id: r.id, fit: scoreRsc({ titulo: r.program, focus: r.focus, whyReforesta: r.whyReforesta }) }));
  const ccaa = items.map((o) => ({
    regiones: o.region ? [o.region] : [],
    organismo: o.organismo,
    nivelAdmin: o.nivelAdmin,
    result: inferComunidadAutonoma(o.region ? [o.region] : [], o.organismo, o.nivelAdmin),
  }));
  ccaa.push(...["ES300 Madrid", "ES611 - Almería", "es12", "XX"].map((r) => ({ regiones: [r], organismo: "", nivelAdmin: "ESTADO", result: inferComunidadAutonoma([r], "", "ESTADO") })));
  const normalize = items.map((o) => ({ input: `${o.titulo} ${o.organismo}`, output: normalizeText(`${o.titulo} ${o.organismo}`) }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const hashes = items.map(({ fit: _fit, ...o }) => ({ id: o.id, contentHash: contentHash({ ...o, fit: null } as never), dedupeKey: dedupeKey(o as never) }));

  const profile = {
    keywordRules: P.KEYWORD_RULES,
    ongPositiveTerms: P.ONG_POSITIVE_TERMS,
    dealbreakerTerms: P.DEALBREAKER_TERMS,
    geoFit: P.GEO_FIT,
    kindFit: P.KIND_FIT,
    manualSources: P.REFORESTA_PROFILE.manualSources,
    workLineLabels: P.WORK_LINE_LABELS,
    rscOpportunities: RSC_OPPORTUNITIES,
    scoringVersion: SCORING_VERSION,
  };
  const out = { now: NOW, tz: process.env.TZ ?? null, profile, score, geo, rsc, ccaa, normalize, hashes };
  fs.writeFileSync(path.join(dir, "ts_functions.json.gz"), zlib.gzipSync(JSON.stringify(out)));
  console.log(`wrote ${score.length} score, ${geo.length} geo/kind, ${rsc.length} rsc, ${ccaa.length} ccaa, ${hashes.length} hash cases`);
}

main();
