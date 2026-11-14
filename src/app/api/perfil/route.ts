import * as Profile from "@/lib/reforesta-profile";
import { DEALBREAKER_TERMS, KEYWORD_RULES, ONG_POSITIVE_TERMS, REFORESTA_PROFILE, WORK_LINE_LABELS } from "@/lib/reforesta-profile";

/** The default scoring rules, read-only, so the Perfil screen can show what the radar already assumes. */
export function GET() {
  const geo = (Profile as Record<string, unknown>).GEO_FIT;
  return Response.json({
    profile: REFORESTA_PROFILE,
    workLines: KEYWORD_RULES.map((g) => ({ line: g.line, label: WORK_LINE_LABELS[g.line], keywords: g.keywords })),
    ngoTerms: ONG_POSITIVE_TERMS,
    dealbreakers: DEALBREAKER_TERMS,
    usualSources: REFORESTA_PROFILE.manualSources.map((s) => s.label),
    tiers: { alto: 60, medio: 40 },
    ...(geo ? { geo } : {}),
  });
}
