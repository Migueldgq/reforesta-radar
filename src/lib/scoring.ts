import {
  DEALBREAKER_TERMS,
  GEO_FIT,
  KEYWORD_RULES,
  KIND_FIT,
  ONG_POSITIVE_TERMS,
  REFORESTA_PROFILE,
} from "./reforesta-profile";
import type { FitAnalysis, WorkLine } from "./types";

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const regexCache = new Map<string, RegExp>();
/** Word-start match on already-normalised text ("aves" won't match "naves"). */
export function hasTerm(normText: string, term: string): boolean {
  let re = regexCache.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^a-z0-9])${escaped}`);
    regexCache.set(term, re);
  }
  return re.test(normText);
}

export interface ScoreInput {
  titulo: string;
  organismo: string;
  tipoConvocatoria?: string | null;
  beneficiarios?: string[];
  regiones?: string[];
  /** CCAA name, used only to detect the "Comunidad de Madrid" manual source. */
  region?: string | null;
  presupuestoTotal?: number | null;
  fechaInicioSolicitud?: string | null;
  fechaFinSolicitud?: string | null;
  abierto?: boolean;
  /** Purpose / description text (finalidad, bases, summary). Used for topic matching. */
  extraText?: string;
  /** Licitaciones / boletín notices: not grants, ONG eligibility unknown. */
  kind?: "subvencion" | "licitacion" | "boletin" | "europa" | "empresa";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function tierFor(score: number): FitAnalysis["tier"] {
  return score >= 60 ? "alto" : score >= 40 ? "medio" : "bajo";
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const LOCAL_ONLY_TERMS = [
  "ayuntamientos",
  "entidades locales",
  "municipios",
  "diputaciones",
  "corporaciones locales",
  "concellos",
  "ajuntaments",
  "entitats locals",
  "mancomunidades",
];

const ENV_ORGANISM_TERMS = [
  "medio ambiente",
  "medi ambient",
  "medio natural",
  "transicion ecologica",
  "sostenibilidad",
  "biodiversidad",
  "forestal",
  "montes",
  "ingurumen",
  "accion climatica",
  "cambio climatico",
];

export function scoreConvocatoria(input: ScoreInput): FitAnalysis {
  const topicText = normalizeText(`${input.titulo} ${input.extraText ?? ""}`);
  const titleNorm = normalizeText(input.titulo);
  const organoNorm = normalizeText(input.organismo);
  const tipoNorm = normalizeText(input.tipoConvocatoria ?? "");
  const benefText = normalizeText((input.beneficiarios ?? []).join(" | "));

  let raw = 20;
  const matchedLines = new Set<WorkLine>();
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Topic fit (title + purpose text; never the organism name)
  const matchedLabels = new Set<string>();
  let topic = 0;
  for (const group of KEYWORD_RULES) {
    for (const kw of group.keywords) {
      if (hasTerm(topicText, kw.term)) {
        // title hits weigh fully; purpose-only hits weigh half
        topic += hasTerm(titleNorm, kw.term) ? kw.weight : kw.weight / 2;
        matchedLines.add(group.line);
        matchedLabels.add(kw.label);
      }
    }
  }
  topic = Math.min(topic, 42);
  raw += topic;
  if (matchedLabels.size > 0) {
    reasons.push(`Encaje temático: ${Array.from(matchedLabels).slice(0, 4).join(", ")}.`);
  }
  if (ENV_ORGANISM_TERMS.some((t) => organoNorm.includes(t))) {
    raw += 4;
  }

  // 2. Dealbreakers (each warning counted once)
  const dealText = `${titleNorm} ${tipoNorm}`;
  let hardBlock = false;
  for (const db of DEALBREAKER_TERMS) {
    if (hasTerm(dealText, db.term) && !warnings.includes(db.warning)) {
      raw -= db.penalty;
      warnings.push(db.warning);
      if (db.penalty >= 40) hardBlock = true;
    }
  }

  // 3. Competitive vs direct / nominative
  const isDirect =
    tipoNorm.includes("directa") ||
    tipoNorm.includes("nominativa") ||
    hasTerm(titleNorm, "nominativa") ||
    hasTerm(titleNorm, "subv.nom") ||
    hasTerm(titleNorm, "concesion directa") ||
    hasTerm(titleNorm, "subvencion directa");
  const isCompetitive = !isDirect && !hasTerm(titleNorm, "convenio");
  if (tipoNorm.includes("concurrencia competitiva")) {
    raw += 12;
    reasons.push("Concurrencia competitiva: cualquier entidad que cumpla requisitos puede optar.");
  } else if (isDirect && !warnings.some((w) => w.startsWith("Subvención nominativa") || w.startsWith("Concesión directa"))) {
    raw -= 40;
    warnings.push("Concesión directa/nominativa: ya asignada a un beneficiario.");
  }

  // 4. Eligibility for an NGO
  let isOngEligible: boolean | null = null;
  const ongInBenef = ONG_POSITIVE_TERMS.some((t) => hasTerm(benefText, t));
  // "interés general/social" and "IRPF" also appear in bases of unrelated aid: only trust them in the title
  const titleOnly = new Set(["interes general", "interes social", "irpf"]);
  const ongInText = ONG_POSITIVE_TERMS.some((t) => hasTerm(titleOnly.has(t) ? titleNorm : topicText, t));
  if (input.kind === "empresa") {
    isOngEligible = true;
  } else if (ongInText) {
    isOngEligible = true;
    raw += 14;
    reasons.push("Menciona expresamente entidades sin ánimo de lucro (ONG, asociaciones, fundaciones).");
  } else if (ongInBenef) {
    isOngEligible = true;
    raw += 10;
    reasons.push("Beneficiarios: personas jurídicas sin actividad económica (categoría donde encajan las ONG).");
  } else if (benefText) {
    const onlyBusiness =
      !benefText.includes("personas juridicas que no") &&
      (benefText.includes("pyme") ||
        benefText.includes("gran empresa") ||
        /personas fisicas que desarrollan/.test(benefText));
    if (onlyBusiness) {
      isOngEligible = false;
      raw -= 22;
      warnings.push(`Beneficiarios: ${(input.beneficiarios ?? []).join(", ").toLowerCase()} — probablemente excluye ONG.`);
    }
  }
  if (LOCAL_ONLY_TERMS.some((t) => hasTerm(titleNorm, t)) && !ongInText) {
    raw -= 18;
    isOngEligible = isOngEligible === true && ongInBenef ? null : false;
    warnings.push("Dirigida a entidades locales (ayuntamientos): Reforesta solo podría participar como socio.");
  }

  // 5. Manual sources: match the ORGANISM only
  let manualSourceMatch: string | null = null;
  for (const src of REFORESTA_PROFILE.manualSources) {
    if (src.patterns.some((p) => organoNorm.includes(p))) {
      manualSourceMatch = src.label;
      break;
    }
  }
  if (
    !manualSourceMatch &&
    input.region === "Comunidad de Madrid" &&
    ENV_ORGANISM_TERMS.some((t) => organoNorm.includes(t)) &&
    input.kind !== "licitacion"
  ) {
    manualSourceMatch = "Comunidad de Madrid (ambiental)";
  }
  const outsideManualSources = manualSourceMatch === null;
  if (outsideManualSources && input.kind !== "empresa") {
    raw += 4;
    reasons.push("No es de los organismos que ya revisáis a mano (Fundación Biodiversidad, MITECO, Comunidad de Madrid, Agenda 2030): fácil que se os pase.");
  }

  // 6. Deadline state from real dates
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = parseDate(input.fechaFinSolicitud);
  const start = parseDate(input.fechaInicioSolicitud);
  let daysRemaining: number | null = null;
  let deadlineState: FitAnalysis["deadlineState"] = "sin_fecha";

  if (end) {
    daysRemaining = Math.round((end.getTime() - today.getTime()) / DAY_MS);
    if (daysRemaining < 0) deadlineState = "cerrada";
    else if (start && start.getTime() > today.getTime()) deadlineState = "proxima";
    else deadlineState = "abierta";
  } else if (start && start.getTime() > today.getTime()) {
    deadlineState = "proxima";
  } else if (input.abierto === true) {
    deadlineState = "abierta";
  } else if (input.abierto === false && start && start.getTime() <= today.getTime() - 45 * DAY_MS) {
    // started 45+ days ago, BDNS says not open and no end date: treat as closed
    deadlineState = "cerrada";
  }

  // Closed competitive grant open to non-profits = next year's pipeline: keep its fit, small timing
  // penalty only (an open equivalent gets +10, so it always ranks above). Anything else closed sinks.
  const recurringGrant =
    input.kind === "subvencion" && isCompetitive && !hardBlock && !isDirect && isOngEligible !== false;
  if (deadlineState === "cerrada") {
    raw += recurringGrant ? 4 : -15;
    const closedOn = end ? end.toLocaleDateString("es-ES") : null;
    if (isCompetitive && !hardBlock) {
      reasons.push(
        `Convocatoria periódica: la edición actual ${closedOn ? `cerró el ${closedOn}` : "ya cerró"}; prepara la siguiente con tiempo.`
      );
    } else {
      warnings.push("Plazo cerrado.");
    }
  } else if (deadlineState === "abierta") {
    raw += 10;
    if (daysRemaining !== null && daysRemaining <= 7) {
      warnings.push(`Cierra en ${daysRemaining} día${daysRemaining === 1 ? "" : "s"}: valorar si da tiempo.`);
    } else {
      reasons.push(
        daysRemaining !== null
          ? `Plazo abierto: quedan ${daysRemaining} días.`
          : "Plazo de solicitud abierto."
      );
    }
  } else if (deadlineState === "proxima") {
    raw += 8;
    reasons.push("Abre próximamente: margen para preparar la memoria.");
  }

  // 7. Budget
  if (input.presupuestoTotal && input.presupuestoTotal >= 50000) raw += 3;

  // 8. Caps so non-applicable items never float to the top
  let score = Math.round(raw);
  if (matchedLabels.size === 0) score = Math.min(score, 35);
  if (hardBlock || isDirect) score = Math.min(score, 25);
  if (deadlineState === "cerrada" && !recurringGrant) score = Math.min(score, 50);
  if (isOngEligible === false) score = Math.min(score, 45);
  score = Math.max(0, Math.min(100, score));

  const tier = tierFor(score);
  if (reasons.length === 0) reasons.push("Coincidencia parcial con el ámbito ambiental.");

  return {
    score,
    tier,
    workLines: Array.from(matchedLines),
    outsideManualSources,
    manualSourceMatch,
    isCompetitive,
    isOngEligible,
    reasons,
    warnings,
    daysRemaining,
    deadlineState,
  };
}

const LOCAL_PREFIX = /^(ayuntamiento|ajuntament|concello|udala|ayto\.?)\s+(de\s+|del\s+|d'\s*)?/i;
const SUPRAMUNICIPAL = /^(diputaci|cabildo|consell insular|consell comarcal|comarca|mancomunidad|junta general)/;
const MINOR_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "i", "en"]);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && MINOR_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Geographic fit on top of the base fit: can Reforesta (Madrid) realistically apply from where it is?
 * Pure: returns a new FitAnalysis and never mutates `base`, so it is safe to apply to cached items
 * (always pass the stored base fit, never an already-adjusted one). Table: GEO_FIT in reforesta-profile.ts.
 */
export function geographicFit(o: { region: string; nivelAdmin: string; organismo: string; kind: string; fit: FitAnalysis }): FitAnalysis {
  const base = o.fit;
  const region = o.region === "Principado de Asturias" ? "Asturias" : o.region;
  const entity = o.organismo.split(" · ")[0].trim();
  const entityNorm = normalizeText(entity);
  const isMunicipal = o.nivelAdmin === "Local" && !SUPRAMUNICIPAL.test(entityNorm);
  const known = region !== "Sin determinar" && region !== "";

  let delta = 0;
  let reason: string | null = null;
  let warning: string | null = null;
  let cap = 100;
  if (o.nivelAdmin === "Privada" && (region === "Estatal" || !known)) {
    // nationwide private/RSC programme: no territorial restriction
  } else if (region === "Comunidad de Madrid") {
    const g = isMunicipal ? GEO_FIT.madridMunicipal : GEO_FIT.regions[region];
    delta = g.delta;
    reason = g.reason;
  } else if (isMunicipal) {
    const name = titleCase(entity.replace(LOCAL_PREFIX, ""));
    delta = GEO_FIT.otherMunicipal;
    warning = `Convocatoria municipal de ${name}${known && region !== "Estatal" ? ` (${region})` : ""}: normalmente exige sede en el municipio.`;
  } else if (GEO_FIT.regions[region] && (o.nivelAdmin !== "Estatal" || region === "Estatal")) {
    delta = GEO_FIT.regions[region].delta;
    reason = GEO_FIT.regions[region].reason;
    cap = GEO_FIT.regions[region].cap ?? 100;
  } else if (known && region !== "Estatal" && o.nivelAdmin !== "Estatal" && o.nivelAdmin !== "UE") {
    delta = GEO_FIT.otherRegion;
    warning = `Convocatoria de ${region}: suele exigir sede o actuación allí.`;
  }
  if (delta === 0) return base;

  let score = Math.max(0, Math.min(cap, base.score + delta));
  if (delta < 0) score = Math.min(score, GEO_FIT.outOfTerritoryCap);
  // closed competitive grants for non-profits keep their fit (timing is shown by deadlineState, not the tier)
  const recurringGrant = o.kind === "subvencion" && base.isCompetitive && base.isOngEligible !== false;
  if (base.deadlineState === "cerrada" && !recurringGrant) score = Math.min(score, Math.max(base.score, GEO_FIT.closedCap));
  return {
    ...base,
    score,
    tier: tierFor(score),
    reasons: reason ? [reason, ...base.reasons] : base.reasons,
    warnings: warning ? [warning, ...base.warnings] : base.warnings,
  };
}

function titleTopic(titulo: string): number {
  const t = normalizeText(titulo);
  let sum = 0;
  for (const group of KEYWORD_RULES) for (const kw of group.keywords) if (hasTerm(t, kw.term)) sum += kw.weight;
  return sum;
}

const CALL_IN_TITLE = /(convoca|extracto|bases reguladoras)/;
const GRANT_IN_TITLE = /(subvenc|ayuda|premio)/;

/**
 * Actionability by kind (table KIND_FIT): a grant Reforesta can apply to outranks tenders, informative
 * bulletin entries and research-consortium topics. Pure, applied after geographicFit on the cached base fit.
 */
export function kindFit(o: { kind: string; titulo: string; organismo: string; fit: FitAnalysis }): FitAnalysis {
  const fit = o.fit;
  const titleNorm = normalizeText(o.titulo);
  let score = fit.score;
  const warnings: string[] = [];
  const weakTopic = o.kind !== "europa" && titleTopic(o.titulo) < KIND_FIT.minTitleTopic;

  if (o.kind === "licitacion") {
    score = Math.min(score - KIND_FIT.tenderPenalty, KIND_FIT.tenderCap);
    warnings.push("Licitación: es un contrato de servicios; exige solvencia técnica y oferta económica.");
    if (weakTopic) score = Math.min(score, KIND_FIT.offTopicCap);
  } else if (o.kind === "boletin" && !(CALL_IN_TITLE.test(titleNorm) && GRANT_IN_TITLE.test(titleNorm))) {
    score = Math.min(score, KIND_FIT.bulletinCap);
    warnings.push("Publicación informativa: no es una convocatoria a la que presentarse.");
    if (weakTopic) score = Math.min(score, KIND_FIT.offTopicCap);
  } else if (o.kind === "europa" && o.organismo.includes("Horizon Europe")) {
    score = Math.min(score, KIND_FIT.horizonCap);
  }
  if (/^(universidad|universitat|universidade)/.test(normalizeText(o.organismo))) {
    score = Math.min(score, KIND_FIT.universityCap);
    warnings.push("Convocatoria de una universidad: suele dirigirse a su propia comunidad universitaria.");
  }
  if (score === fit.score && warnings.length === 0) return fit;
  score = Math.max(0, score);
  return { ...fit, score, tier: tierFor(score), warnings: [...warnings, ...fit.warnings.filter((w) => !warnings.includes(w))] };
}

/** Fit for hand-curated private (RSC) programmes. */
export function scoreRsc(input: { titulo: string; focus: WorkLine[]; whyReforesta: string }): FitAnalysis {
  const base = scoreConvocatoria({
    titulo: input.titulo,
    organismo: "",
    extraText: input.whyReforesta,
    kind: "empresa",
  });
  const lines = Array.from(new Set([...input.focus, ...base.workLines]));
  const score = Math.max(52, Math.min(66, 46 + lines.length * 4 + Math.round(base.score / 10)));
  return {
    ...base,
    score,
    tier: "medio",
    workLines: lines,
    outsideManualSources: true,
    manualSourceMatch: null,
    isCompetitive: true,
    isOngEligible: true,
    reasons: [
      "Programa privado seleccionado a mano: financia proyectos ambientales de ONG en España.",
      "Canal RSC: hoy Reforesta no lo trabaja de forma proactiva.",
    ],
    warnings: ["Sin plazo fijo publicado: confirmar calendario en la web de la entidad."],
    daysRemaining: null,
    deadlineState: "sin_fecha",
  };
}
