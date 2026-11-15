# API contract: accounts, team board and settings

Contract for the web app (Next.js, `src/`) against the Python API (`backend/`). The live, always-accurate schema is
OpenAPI at `http://localhost:8010/docs`; this page adds the rules the schema cannot express. JSON is camelCase.
Timestamps are ISO 8601 with offset (`2026-11-15T13:18:36.655384+00:00`); dates are `YYYY-MM-DD`.

## Rules that apply everywhere

| Rule | Detail |
|---|---|
| Same origin | The browser calls `/api/*` on the web origin; Next.js rewrites it to the API (`next.config.ts`). Never call the API port from the browser. |
| Session cookie | `radar_session`: opaque random token, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 30 days, `Secure` when `RADAR_COOKIE_SECURE=true` (set it behind https). The API sets and clears it; JavaScript can neither read nor needs to. Expiry is server-side, 30 days after the last use (sliding). |
| CSRF | Every `POST`, `PUT`, `PATCH`, `DELETE` under `/api/` (login and logout included) **must send `X-Radar-CSRF: 1`**. Requests whose `Sec-Fetch-Site` is `cross-site` or `same-site` are rejected even with the header. Missing/wrong → `403 {"detail": "Petición rechazada (falta la cabecera X-Radar-CSRF o viene de otro sitio)."}`. GETs need nothing. Simplest: one `fetch` wrapper that always adds the header (also for the multipart `/api/analyze-pdf`). |
| Who may call what | Open: `GET /health`, `/api/auth/*`, `/api/public/*`. Everything else under `/api/` needs a session (401 without). Admin-only routes (marked **admin** below) answer 403 to members. Members can edit everything on the board. |
| Body size | Bodies over **1 MiB** (16 MiB on `/api/analyze-pdf`) get `413 {"detail": "La petición es demasiado grande."}` before anything else (session check included). |
| Errors | `{"detail": "<Spanish message, ready to show>"}` with the status code. Validation errors from the schema are FastAPI's `422 {"detail": [{"loc": [...], "msg": "...", ...}]}` (English, for developers: validate in the form before sending). Exceptions: `POST /api/ingest` 409 carries more fields (below); `/api/analyze-pdf` keeps its old `{"error": "..."}` shape. |
| 401 | `{"detail": "No has iniciado sesión o la sesión ha caducado."}` on any protected route: send the user to the login page (keep the current URL to come back). |
| 403 | `{"detail": "Solo un administrador puede hacer esto."}`: hide admin-only UI for members (`user.role`). |

## Web pages the frontend must implement

| Path | Purpose |
|---|---|
| `/login` (any name) | Email + password form → `POST /api/auth/login`. |
| `/invitacion/<token>` | Link an admin sends to a new person. Look it up with `POST /api/auth/invitation`, show the e-mail **read-only**, ask for name + password (twice) → `POST /api/auth/invitation/accept`. |
| `/restablecer/<token>` | Password reset link. Look it up with `POST /api/auth/reset`, ask for the new password → `POST /api/auth/reset/accept`. |

Links are built by the API as `RADAR_PUBLIC_URL + "/invitacion/" + token` and `RADAR_PUBLIC_URL + "/restablecer/" +
token` (`RADAR_PUBLIC_URL` defaults to `http://localhost:3010`; set it to the real public URL). The token is
URL-safe base64 (43 chars). On those two pages: send the token to the API in the JSON body (the API never takes
tokens in its paths, so they stay out of access logs), set `Referrer-Policy: no-referrer` and do not load third-party
resources, so the token never leaks through a `Referer`.

The landing stays public: it must read **`GET /api/public/oportunidades`** (server-side) instead of
`/api/oportunidades`, which now needs a session.

## Shared shapes

```ts
type Role = "admin" | "member";
type Me = { id: number; email: string; name: string; role: Role };
type SessionInfo = { user: Me | null; forgotPassword: boolean }; // forgotPassword: show "¿Olvidaste la contraseña?"
type PersonRef = { id: number; name: string };
type Triage = "nueva" | "estudio" | "presentar" | "presentada" | "descartada"; // same as src/components/radar/model.ts
```

## Auth (`/api/auth/*`, no session needed)

| Method + path | Body | 2xx | Errors |
|---|---|---|---|
| `GET /api/auth/session` | – | `200 SessionInfo` (`user: null` when logged out; never 401) | – |
| `POST /api/auth/login` | `{email, password}` | `200 SessionInfo` + `Set-Cookie` | `401 "Correo o contraseña incorrectos."` (same for unknown, wrong password, deactivated); `429 "Demasiados intentos..."` + `Retry-After` seconds |
| `POST /api/auth/logout` | – | `204`, cookie cleared, session deleted server-side | – |
| `POST /api/auth/invitation` | `{token}` | `200 {email, name, role, expiresAt}` | `404 "El enlace no es válido o ha caducado. Pide uno nuevo a un administrador."` (unknown, used, revoked or expired alike) |
| `POST /api/auth/invitation/accept` | `{token, name?, password}` | `201 SessionInfo` + `Set-Cookie` (logged in) | `400` password too short/long; `404` as above; `409 "Ya existe una cuenta con ese correo..."` |
| `POST /api/auth/reset` | `{token}` | `200 {email, expiresAt}` | `404` as above (also when the account is deactivated) |
| `POST /api/auth/reset/accept` | `{token, password}` | `200 SessionInfo` + `Set-Cookie`; every other session of that user is ended | `400`, `404` |
| `POST /api/auth/forgot` | `{email}` | `202 {"ok": true}` always (never says whether the address exists) | `404` when e-mail is not configured (`forgotPassword: false`); `429` |

- Passwords: 10 to 256 characters, no composition rules. The API's 400 message says which limit failed.
- Login throttling (failures within 15 min; every attempt is counted *before* the password is checked, so parallel
  guesses cannot slip through):
  1. **Per account, hard ceiling: 50.** Once reached, every login to that account gets `429` without checking the
     password, from any client, until the window moves on. This bounds online guessing to ~200 per hour per account.
  2. **Per (account, client IP): 5.** Past it, a *wrong* password from that client gets `429` (instead of 401) with
     `Retry-After`. A **right password still logs in**: below the ceiling, nobody else's failures ever refuse a
     correct password (behind the Next.js proxy all browsers may share one IP).
  A successful login takes back its own attempt and clears its (account, IP) counter. Show the 429 `detail` and
  disable the button for `Retry-After` seconds.
- The client IP is the TCP peer unless `FORWARDED_ALLOW_IPS` names a trusted proxy (default: none; see
  docs/backend.md). Password hashing runs at most `RADAR_ARGON2_CONCURRENCY` (2) at a time: under a burst, logins
  wait (slower answers), they do not fail.
- The invitation's e-mail is fixed: `accept` ignores any `email` field.
- `name` on accept is optional (falls back to the name the admin typed in the invitation; may be empty). Ask for it.

## Self (`/api/me*`, any signed-in user)

| Method + path | Body | 2xx | Errors |
|---|---|---|---|
| `PATCH /api/me` | `{name}` (1-100) | `200 Me` | `400` empty |
| `POST /api/me/password` | `{currentPassword, newPassword}` | `204`; all sessions ended, a fresh cookie is set for this browser | `400 "La contraseña actual no es correcta."` or length; `429` after 5 wrong current passwords in 15 min (per user; it never affects logging in) |

## People

| Method + path | Who | Body | 2xx | Errors |
|---|---|---|---|---|
| `GET /api/users` | any | – | `200 {users: {id, name, active}[]}` (assignee picker, authors; inactive people stay listed for old notes; only active ones can be assigned) | – |
| `GET /api/team` | **admin** | – | `200 {users: TeamUser[], invitations: PendingInvitation[], resets: PendingReset[]}` | – |
| `POST /api/team/invitations` | **admin** | `{email, name?, role?: Role = "member"}` | `201 {invitation: PendingInvitation, link, expiresAt, emailed}` | `400` invalid e-mail; `409` account exists |
| `DELETE /api/team/invitations/{id}` | **admin** | – | `204` | `404` not pending |
| `PATCH /api/team/users/{id}` | **admin** | `{role?, active?}` | `200 TeamUser` | `404`; `409 "Tiene que quedar al menos un administrador activo."` |
| `POST /api/team/users/{id}/reset-link` | **admin** | – | `201 {link, expiresAt, emailed}` | `404` unknown or deactivated |
| `DELETE /api/team/resets/{id}` | **admin** | – | `204` (that reset link stops working) | `404` not pending |

```ts
type TeamUser = { id: number; email: string; name: string; role: Role; active: boolean; createdAt: string; lastLoginAt: string | null };
type PendingInvitation = { id: number; email: string; name: string; role: Role; createdAt: string; expiresAt: string; createdBy: number | null };
type PendingReset = { id: number; userId: number; userName: string; createdBy: number | null /* null: self-service e-mail */; createdAt: string; expiresAt: string };
```

- `link` is shown **once** (only its hash is stored): display it with a copy button and the hint "envíalo tú por un
  canal privado; caduca en 7 días (invitación) / 24 horas (restablecer) y sirve una sola vez". `emailed: true`
  means the API also e-mailed it (only with SMTP configured).
- A new invitation to an address with a pending one replaces it; a new reset link invalidates the previous one.
- Role change and deactivation end that person's sessions at once (an admin who demotes themself is logged out).
  When someone **loses admin or is deactivated**, the pending invitations and unused reset links *they created*
  stop working at once (and, on deactivation, their own pending reset links too); the team screen should list
  `invitations` and `resets` with a "Revocar" button each, showing who created them (`createdBy`).
  There is no delete: deactivate. Keep at least two admins (docs/backend.md).

## Board (`/api/board*`, any signed-in user)

```ts
type Note = { id: number; author: PersonRef | null; body: string; createdAt: string };
type BoardItem = {
  opportunityId: string;       // Opportunity.id, e.g. "bdns:923290"
  status: Triage;
  assignee: PersonRef | null;
  notes: Note[];               // oldest first
  titulo: string; organismo: string; source: string; url: string; deadline: string | null; // snapshot
  gone: boolean;               // not in the latest ingest: show "Ya no aparece en las fuentes"
  updatedBy: PersonRef | null; updatedAt: string;
};
```

| Method + path | Body | 2xx | Errors |
|---|---|---|---|
| `GET /api/board` | – | `200 {items: BoardItem[]}` (most recently updated first) | – |
| `PATCH /api/board/{opportunityId}` | `{status?, assigneeId?: number \| null}` (send only what changes; `null` unassigns) | `200 BoardItem` | `400` assignee unknown/inactive; `404 "Esa convocatoria no está en el radar."` (never seen and not on the board) |
| `POST /api/board/{opportunityId}/notes` | `{body}` (1-4000) | `201 Note` | `404` |
| `DELETE /api/board/{opportunityId}/notes/{noteId}` | – | `204` | `403` not the author and not admin; `404` |

- A call absent from `/api/board` is `"nueva"` (what `triageOf` returns today). Setting `"nueva"` keeps the row
  (and its notes and assignee); it is not deleted.
- Use the board item's snapshot to draw cards of calls missing from `/api/oportunidades` (replaces today's `stub()`
  built from the localStorage entry). The snapshot is refreshed on every write while the call is still known.
- `opportunityId` goes in the path as is (`bdns:923290`); `encodeURIComponent` is safe too.
- Concurrency: last write wins per field. Re-fetch `GET /api/board` on focus or every minute to see colleagues'
  changes.

## Organisation settings (any signed-in user)

| Method + path | Body | 2xx |
|---|---|---|
| `GET /api/settings` | – | `200 {profile: UserProfile \| null, organisms: string[] \| null, updatedBy: PersonRef \| null, updatedAt: string \| null}` |
| `PUT /api/settings` | `{profile?: UserProfile \| null, organisms?: string[] \| null}` (partial: omitted fields are kept) | `200` same shape |

- `profile` is exactly `UserProfile` of `src/components/radar/profile.ts` (`extraKeywords`, `excludedTerms`,
  `linePriority`, `regionAdjust`, `kinds`, `minBudget`, `hideMunicipalOutsideRegions`); run `parseProfile` before
  sending (out-of-range values get a 422). `null` (or a neutral profile) means the default: use
  `DEFAULT_USER_PROFILE`. `minBudget` comes back as a float (`5000.0`).
- `organisms` replaces `reforesta-radar:organismos:v1`; `null` or `[]` = no organism filter. The URL still wins
  over it on load, as today.
- One profile for the whole team; last write wins. Show "Editado por {updatedBy.name}, {fecha}".

## Votes

```ts
type Vote = { opportunityId: string; user: PersonRef; vote: "sirve" | "no_sirve"; reason: string; updatedAt: string };
```

| Method + path | Who | Body | 2xx | Errors |
|---|---|---|---|---|
| `GET /api/votes` | any | – | `200 {votes: Vote[]}` (everyone's; group by `opportunityId`) | – |
| `PUT /api/votes/{opportunityId}` | any | `{vote, reason?}` (reason ≤ 2000) | `200 Vote` (one per person and call; voting again replaces it) | `404` unknown call; `422` other values |
| `DELETE /api/votes/{opportunityId}` | any | – | `204` (my vote) | – |
| `GET /api/votes/disagreements` | **admin** | – | `200 {items: {opportunityId, titulo, source, url, score, tier, kind: "sirve_bajo" \| "no_sirve_alto" \| "ambos", votes: Vote[]}[]}` | – |

Disagreement = a live call voted "sirve" with server score < 40, or "no sirve" with score ≥ 60. `score` is the
API's score (read-time fit), **without** the team's Perfil adjustments. Calls gone from the sources are left out.

## Import of the browser's old state (first login)

`POST /api/import` (any signed-in user):

```jsonc
{
  "tracking": { "<opportunityId>": { "status": "estudio", "at": "...", "titulo": "...", "organismo": "...", "deadline": null } }, // reforesta-radar:seguimiento:v1 as is
  "profile": { /* reforesta-radar:perfil:v1, through parseProfile */ },  // optional
  "organisms": ["MITECO"]                                                 // reforesta-radar:organismos:v1, optional
}
```

Response `200 {trackingImported, trackingKept, trackingSkipped, profile: "imported"|"kept"|"none", organisms: "imported"|"kept"|"none"}`.
Limits: at most 2000 tracking entries (422 above) and a 1 MiB body (413).

**Merge rule: what the team already saved always wins; the browser only fills gaps.**
- Tracking: each entry with a status other than `nueva` becomes a board row **only if the call has no row yet**;
  an existing row is left untouched (`trackingKept`). Only calls the radar knows (in its data, current or gone from
  the sources) are imported; never-seen ids are skipped (`trackingSkipped`). The snapshot always comes from the
  radar's data (the entry's `titulo`, `organismo`, `deadline` and `at` are ignored). Imported rows are attributed
  to the importing user, at import time.
- Profile and organisms: imported only if the team has never saved one (`null` on the server) and the imported
  value is not neutral / empty.
- Idempotent: importing the same data again changes nothing.

Suggested client flow: after the first successful login in a browser that still has any `reforesta-radar:*` key
(except `payload`), call `/api/import` once, show "Importados N seguimientos de este navegador", then delete the
`seguimiento`, `perfil` and `organismos` keys. From then on read and write only through the API.

## Data update ("Actualizar ahora")

```ts
type IngestRequest = { id: number; status: "requested" | "running" | "done" | "failed"; requestedBy: string | null;
  requestedAt: string; startedAt: string | null; finishedAt: string | null; error: string | null };
type IngestStatus = { latest: IngestRequest | null; lastIngestAt: string | null };
```

| Method + path | Who | 2xx | Errors |
|---|---|---|---|
| `GET /api/ingest` | any | `200 IngestStatus` | – |
| `POST /api/ingest` | **admin** | `202 IngestStatus` (the new request, `requested`) | `409 {detail: "Ya hay una actualización pedida o en marcha.", latest, lastIngestAt}` |

`ingest-scheduler` claims the request within ~30 s and runs the full ingest (a warm run takes about a minute; a
cold one up to ~10 min). Poll `GET /api/ingest` every ~5 s while `latest.status` is `requested` or `running`;
when it is `done`, reload `/api/oportunidades`. Only one request can be open at a time.

## Unchanged routes, now behind the session

`GET /api/oportunidades`, `GET /api/fuentes`, `GET /api/perfil`, `POST /api/analyze-pdf` (send `X-Radar-CSRF: 1`).
`GET /api/public/oportunidades` returns the same `OpportunitiesResponse` without a session (the landing's
`getLandingData` summarises it server-side); it contains only the ingested public calls, never users, board, votes
or the team profile.
