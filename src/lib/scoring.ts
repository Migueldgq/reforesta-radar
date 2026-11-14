import {
  DEALBREAKER_TERMS,
  KEYWORD_RULES,
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
    hasTerm(titleNorm, "concesion directa");
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
  const ongInText = ONG_POSITIVE_TERMS.some((t) => hasTerm(topicText, t));
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
    reasons.push("Fuera de tus 4 fuentes habituales: no la habrías visto revisando a mano.");
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

  if (deadlineState === "cerrada") {
    raw -= 15;
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
  if (deadlineState === "cerrada") score = Math.min(score, 50);
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
