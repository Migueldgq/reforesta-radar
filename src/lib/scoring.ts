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
    .replace(/[\u0300-\u036f]/g, "");
}

export interface ScoreInput {
  titulo: string;
  organismo: string;
  tipoConvocatoria?: string | null;
  beneficiarios?: string[];
  regiones?: string[];
  presupuestoTotal?: number | null;
  fechaInicioSolicitud?: string | null;
  fechaFinSolicitud?: string | null;
  abierto?: boolean;
  extraText?: string;
}

export function scoreConvocatoria(input: ScoreInput): FitAnalysis {
  const fullText = normalizeText(
    [
      input.titulo,
      input.organismo,
      input.tipoConvocatoria ?? "",
      ...(input.beneficiarios ?? []),
      input.extraText ?? "",
    ].join(" ")
  );

  const organoNorm = normalizeText(input.organismo);

  let rawScore = 15; // base
  const matchedLines = new Set<WorkLine>();
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Keyword matching across Reforesta work lines
  const matchedLabels = new Set<string>();
  for (const group of KEYWORD_RULES) {
    let lineHit = false;
    for (const kw of group.keywords) {
      if (fullText.includes(kw.term)) {
        rawScore += kw.weight;
        lineHit = true;
        if (!matchedLabels.has(kw.label)) {
          matchedLabels.add(kw.label);
        }
      }
    }
    if (lineHit) {
      matchedLines.add(group.line);
    }
  }

  if (matchedLabels.size > 0) {
    reasons.push(
      `Encaje temático directo: ${Array.from(matchedLabels).slice(0, 4).join(", ")}.`
    );
  }

  // 2. ONG / Sin ánimo de lucro eligibility
  const benefText = normalizeText((input.beneficiarios ?? []).join(" "));
  const ongSignal = ONG_POSITIVE_TERMS.some(
    (t) => benefText.includes(t) || fullText.includes(t)
  );

  let isOngEligible: boolean | null = null;
  if (ongSignal) {
    isOngEligible = true;
    rawScore += 18;
    reasons.push("Admite entidades sin ánimo de lucro / tercer sector.");
  } else if (
    benefText.includes("pyme") ||
    benefText.includes("personas fisicas") ||
    benefText.includes("entidades locales")
  ) {
    isOngEligible = false;
    rawScore -= 22;
    warnings.push(
      `Beneficiarios declarados (${(input.beneficiarios ?? []).join(", ")}) pueden excluir ONGs.`
    );
  }

  // 3. Concurrencia competitiva vs directa/nominativa
  const tipoNorm = normalizeText(input.tipoConvocatoria ?? "");
  const isCompetitive =
    tipoNorm.includes("concurrencia competitiva") ||
    (!tipoNorm.includes("directa") && !fullText.includes("nominativa"));

  if (tipoNorm.includes("concurrencia competitiva")) {
    rawScore += 12;
    reasons.push("Convocatoria en concurrencia competitiva abierta.");
  } else if (tipoNorm.includes("directa") || tipoNorm.includes("nominativa")) {
    rawScore -= 35;
    warnings.push("Concesión directa/nominativa: probablemente ya asignada.");
  }

  // 4. Outside the 4 manual sources Reforesta already checks
  let manualSourceMatch: string | null = null;
  for (const src of REFORESTA_PROFILE.manualSources) {
    if (src.patterns.some((p) => organoNorm.includes(p) || fullText.includes(p))) {
      manualSourceMatch = src.label;
      break;
    }
  }
  const outsideManualSources = manualSourceMatch === null;
  if (outsideManualSources) {
    rawScore += 8;
    reasons.push("Fuera de tus 4 fuentes habituales (MITECO, F. Biodiversidad, CAM, Agenda 2030).");
  }

  // 5. Dealbreakers
  for (const db of DEALBREAKER_TERMS) {
    if (fullText.includes(db.term)) {
      rawScore -= db.penalty;
      if (!warnings.includes(db.warning)) {
        warnings.push(db.warning);
      }
    }
  }

  // 6. Deadline calculation
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let daysRemaining: number | null = null;
  let deadlineState: FitAnalysis["deadlineState"] = "sin_fecha";

  if (input.fechaFinSolicitud) {
    const end = new Date(input.fechaFinSolicitud);
    if (!Number.isNaN(end.getTime())) {
      const diffMs = end.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (daysRemaining < 0) {
        deadlineState = "cerrada";
        rawScore -= 18;
        warnings.push("Plazo de solicitud cerrado (útil como referencia para próxima edición).");
      } else if (input.fechaInicioSolicitud) {
        const start = new Date(input.fechaInicioSolicitud);
        if (!Number.isNaN(start.getTime()) && start.getTime() > now.getTime()) {
          deadlineState = "proxima";
          rawScore += 6;
          reasons.push("Abre próximamente: margen ideal para preparar la memoria.");
        } else {
          deadlineState = "abierta";
          rawScore += 8;
        }
      } else {
        deadlineState = input.abierto ? "abierta" : "proxima";
      }
    }
  } else if (input.abierto) {
    deadlineState = "abierta";
    rawScore += 6;
  }

  // 7. Budget bonus
  if (input.presupuestoTotal && input.presupuestoTotal >= 50000) {
    rawScore += 5;
  }

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const tier: FitAnalysis["tier"] =
    score >= 68 ? "alto" : score >= 42 ? "medio" : "bajo";

  if (reasons.length === 0) {
    reasons.push("Coincidencia parcial con el ámbito ambiental.");
  }

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
