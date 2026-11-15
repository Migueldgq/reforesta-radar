/** Shapes of the accounts / team API (docs/api-auth.md). */
import type { Triage } from "@/components/radar/model";

export type Role = "admin" | "member";
export type Me = { id: number; email: string; name: string; role: Role };
export type SessionInfo = { user: Me | null; forgotPassword: boolean };
export type PersonRef = { id: number; name: string };
export type TeamPerson = { id: number; name: string; active: boolean };

export type TeamUser = Me & { active: boolean; createdAt: string; lastLoginAt: string | null };
export type PendingInvitation = { id: number; email: string; name: string; role: Role; createdAt: string; expiresAt: string; createdBy: number | null };
export type PendingReset = { id: number; userId: number; userName: string; createdBy: number | null; createdAt: string; expiresAt: string };
export type OneTimeLink = { link: string; expiresAt: string; emailed: boolean };

export type Note = { id: number; author: PersonRef | null; body: string; createdAt: string };
export type BoardItem = {
  opportunityId: string;
  status: Triage;
  assignee: PersonRef | null;
  notes: Note[];
  titulo: string;
  organismo: string;
  source: string;
  url: string;
  deadline: string | null;
  gone: boolean;
  updatedBy: PersonRef | null;
  updatedAt: string;
};

export type VoteValue = "sirve" | "no_sirve";
export type Vote = { opportunityId: string; user: PersonRef; vote: VoteValue; reason: string; updatedAt: string };
export type Disagreement = {
  opportunityId: string;
  titulo: string;
  source: string;
  url: string;
  score: number;
  tier: "alto" | "medio" | "bajo";
  kind: "sirve_bajo" | "no_sirve_alto" | "ambos";
  votes: Vote[];
};

export type IngestRequest = {
  id: number;
  status: "requested" | "running" | "done" | "failed";
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};
export type IngestStatus = { latest: IngestRequest | null; lastIngestAt: string | null };

/** A personal access token for the MCP server (its value is shown only once, on creation). */
export type PersonalToken = { id: number; name: string; createdAt: string; expiresAt: string; lastUsedAt: string | null };
export type TokensInfo = { tokens: PersonalToken[]; mcpUrl: string; publicTools: boolean };
export type TokenCreated = { token: PersonalToken; secret: string };

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

/** "Ana Prueba" → "AP"; one word → first two letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const fmtWhen = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric" });

/** "15 nov, 13:18" (local time). */
export function fmtWhenShort(iso: string): string {
  return fmtWhen.format(new Date(iso)).replace(".", "");
}

/** "15 de noviembre de 2026" (local time). */
export function fmtDayLong(iso: string): string {
  return fmtDay.format(new Date(iso));
}
