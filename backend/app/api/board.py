"""Team state shared by everyone: the tracking board (status, assignee, notes), the organisation's settings (Perfil
profile + organism filter), votes on calls and the one-off import of a browser's old localStorage state.

Tracking is keyed by the stable opportunity id with a snapshot (title, organism, source, url, deadline) refreshed
on every write, so a call that leaves the sources stays on the board with `gone: true`.
"""

import logging
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path, Response
from pydantic import Field
from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.api.state import read_state
from app.auth.deps import Admin, Db, User, now
from app.db.tables import opportunities, org_settings, tracking, tracking_notes, users, votes
from app.models import CleanStr, Contract, OpportunityKind, WorkLine
from app.scoring.rank import rank

log = logging.getLogger("board")
router = APIRouter(tags=["board"])

Triage = Literal["nueva", "estudio", "presentar", "presentada", "descartada"]
VoteValue = Literal["sirve", "no_sirve"]
OpportunityId = Annotated[CleanStr, Field(min_length=1, max_length=200)]
OpportunityPath = Annotated[CleanStr, Path(min_length=1, max_length=200)]
UNKNOWN_CALL = "Esa convocatoria no está en el radar."
SIRVE_LOW, NO_SIRVE_HIGH = 40, 60  # disagreement thresholds on the displayed score


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


class PersonRef(Contract):
    id: int
    name: str


class Note(Contract):
    id: int
    author: PersonRef | None  # null if the author's account was removed from the database
    body: str
    created_at: str


class BoardItem(Contract):
    opportunity_id: str
    status: Triage
    assignee: PersonRef | None
    notes: list[Note]  # oldest first
    # snapshot of the call at the last write (still shown when the call is gone)
    titulo: str
    organismo: str
    source: str
    url: str
    deadline: str | None
    gone: bool  # the call is no longer in the latest ingest ("ya no aparece en las fuentes")
    updated_by: PersonRef | None
    updated_at: str


class BoardResponse(Contract):
    items: list[BoardItem]


class TrackingPatch(Contract):
    status: Triage | None = None
    assignee_id: int | None = None  # send null to unassign; omit to leave as is


class NoteIn(Contract):
    body: Annotated[CleanStr, Field(min_length=1, max_length=4000)]


# ---------- Profile (mirror of UserProfile in src/components/radar/profile.ts; ranges as its parseProfile) ----------

Delta = Annotated[int | float, Field(ge=-10, le=10)]
ALL_KINDS: tuple[OpportunityKind, ...] = ("subvencion", "licitacion", "boletin", "europa", "empresa")


class ExtraKeyword(Contract):
    term: Annotated[CleanStr, Field(min_length=1, max_length=100)]
    weight: Annotated[int, Field(ge=5, le=25)]
    line: WorkLine | None = Field(default=None, exclude_if=lambda v: v is None)


class ExcludedTerm(Contract):
    term: Annotated[CleanStr, Field(min_length=1, max_length=100)]
    penalty: Annotated[int, Field(ge=1, le=100)]


class TeamProfile(Contract):
    extra_keywords: Annotated[list[ExtraKeyword], Field(max_length=200)] = []
    excluded_terms: Annotated[list[ExcludedTerm], Field(max_length=200)] = []
    line_priority: dict[WorkLine, Delta] = {}
    region_adjust: Annotated[dict[Annotated[CleanStr, Field(max_length=100)], Delta], Field(max_length=100)] = {}
    kinds: Annotated[list[OpportunityKind], Field(max_length=5)] = [
        "subvencion",
        "licitacion",
        "boletin",
        "europa",
        "empresa",
    ]
    min_budget: Annotated[float, Field(ge=0)] | None = None
    hide_municipal_outside_regions: bool = False

    def is_neutral(self) -> bool:  # isNeutral() of the web
        return (
            not self.extra_keywords
            and not self.excluded_terms
            and not any(self.line_priority.values())
            and not any(self.region_adjust.values())
            and len(set(self.kinds)) == 5
            and not self.min_budget
            and not self.hide_municipal_outside_regions
        )


Organisms = Annotated[list[Annotated[CleanStr, Field(max_length=300)]], Field(max_length=300)]


class TeamSettings(Contract):
    profile: dict[str, Any] | None  # null: never saved (the web uses its default profile)
    organisms: list[str] | None  # null: never saved
    updated_by: PersonRef | None
    updated_at: str | None


class SettingsPatch(Contract):
    profile: TeamProfile | None = None  # omit to keep; null to reset to the default
    organisms: Organisms | None = None  # omit to keep; null (or []) to clear


# ---------- Votes ----------


class VoteIn(Contract):
    vote: VoteValue
    reason: Annotated[CleanStr, Field(max_length=2000)] = ""


class VoteOut(Contract):
    opportunity_id: str
    user: PersonRef
    vote: VoteValue
    reason: str
    updated_at: str


class VotesResponse(Contract):
    votes: list[VoteOut]


class Disagreement(Contract):
    opportunity_id: str
    titulo: str
    source: str
    url: str
    score: int  # server score (read-time fit, without the team's Perfil adjustments)
    tier: str
    kind: Literal["sirve_bajo", "no_sirve_alto", "ambos"]
    votes: list[VoteOut]


class DisagreementsResponse(Contract):
    items: list[Disagreement]


# ---------- Import ----------


class ImportedTriage(Contract):
    """One entry of localStorage `reforesta-radar:seguimiento:v1` (TriageEntry)."""

    status: Triage
    # the rest of the entry is accepted for compatibility and ignored: the snapshot comes from the radar's data
    at: Annotated[CleanStr, Field(max_length=40)] | None = None
    titulo: Annotated[CleanStr, Field(max_length=1000)] = ""
    organismo: Annotated[CleanStr, Field(max_length=1000)] = ""
    deadline: Annotated[CleanStr, Field(max_length=40)] | None = None


class ImportIn(Contract):
    tracking: Annotated[dict[OpportunityId, ImportedTriage], Field(max_length=2000)] = {}
    profile: TeamProfile | None = None  # `reforesta-radar:perfil:v1`
    organisms: Organisms | None = None  # `reforesta-radar:organismos:v1`


class ImportOut(Contract):
    tracking_imported: int
    tracking_kept: int  # already on the team board: left untouched
    tracking_skipped: int  # ids the radar has never seen: not imported
    profile: Literal["imported", "kept", "none"]
    organisms: Literal["imported", "kept", "none"]


# ---------- helpers ----------


async def _people(conn: AsyncConnection) -> dict[int, PersonRef]:
    return {r.id: PersonRef(id=r.id, name=r.name) for r in await conn.execute(select(users.c.id, users.c.name))}


def _ref(people: dict[int, PersonRef], user_id: int | None) -> PersonRef | None:
    return people.get(user_id) if user_id is not None else None


async def _snapshot(conn: AsyncConnection, opportunity_id: str) -> dict[str, Any] | None:
    """Current title/organism/source/url/deadline of a call (gone calls too: their row is kept)."""
    r = (
        await conn.execute(
            select(
                opportunities.c.titulo,
                opportunities.c.organismo,
                opportunities.c.source,
                opportunities.c.url,
                opportunities.c.data["deadline"].astext.label("deadline"),
            ).where(opportunities.c.id == opportunity_id)  # fmt: skip
        )
    ).first()
    return dict(r._mapping) if r else None


async def _board_items(conn: AsyncConnection, ids: list[str] | None = None) -> list[BoardItem]:
    q = select(tracking).order_by(tracking.c.updated_at.desc())
    if ids is not None:
        q = q.where(tracking.c.opportunity_id.in_(ids))
    rows = list(await conn.execute(q))
    if not rows:
        return []
    keys = [r.opportunity_id for r in rows]
    live = {
        r.id
        for r in await conn.execute(
            select(opportunities.c.id).where(opportunities.c.id.in_(keys), opportunities.c.gone_at.is_(None))
        )
    }
    people = await _people(conn)
    notes: dict[str, list[Note]] = {k: [] for k in keys}
    for n in await conn.execute(
        select(tracking_notes).where(tracking_notes.c.opportunity_id.in_(keys)).order_by(tracking_notes.c.id)
    ):
        notes[n.opportunity_id].append(
            Note(id=n.id, author=_ref(people, n.author_id), body=n.body, created_at=n.created_at.isoformat())
        )
    return [
        BoardItem(
            opportunity_id=r.opportunity_id,
            status=r.status,
            assignee=_ref(people, r.assignee_id),
            notes=notes[r.opportunity_id],
            titulo=r.titulo,
            organismo=r.organismo,
            source=r.source,
            url=r.url,
            deadline=r.deadline,
            gone=r.opportunity_id not in live,
            updated_by=_ref(people, r.updated_by),
            updated_at=r.updated_at.isoformat(),
        )  # fmt: skip
        for r in rows
    ]


async def _ensure_row(conn: AsyncConnection, opportunity_id: str, user_id: int) -> None:
    """Creates the tracking row (status nueva) if missing and refreshes its snapshot. 404 for an unknown call."""
    snap = await _snapshot(conn, opportunity_id)
    exists = (
        await conn.execute(select(tracking.c.opportunity_id).where(tracking.c.opportunity_id == opportunity_id))
    ).first()
    if snap is None and exists is None:
        raise HTTPException(404, detail=UNKNOWN_CALL)
    if exists is None:
        await conn.execute(
            insert(tracking).values(opportunity_id=opportunity_id, status="nueva", updated_by=user_id, **snap or {})
        )
    elif snap is not None:
        await conn.execute(update(tracking).where(tracking.c.opportunity_id == opportunity_id).values(**snap))


# ---------- board ----------


@router.get("/api/board", response_model=BoardResponse)
async def board(_: User, conn: Db) -> BoardResponse:
    """Every tracked call, most recently updated first. Calls not on the board are "nueva" for the web."""
    return BoardResponse(items=await _board_items(conn))


@router.patch("/api/board/{opportunity_id}", response_model=BoardItem, responses={400: {}, 404: {}})
async def patch_tracking(opportunity_id: OpportunityPath, body: TrackingPatch, user: User, conn: Db) -> BoardItem:
    """Set status and/or assignee (send only what changes). Creates the board entry on first use."""
    values: dict[str, Any] = {}
    if body.status is not None:
        values["status"] = body.status
    if "assignee_id" in body.model_fields_set:
        if body.assignee_id is not None:
            ok = (await conn.execute(select(users.c.id).where(users.c.id == body.assignee_id, users.c.active))).first()
            if ok is None:
                raise HTTPException(400, detail="Esa persona no existe o está desactivada.")
        values["assignee_id"] = body.assignee_id
    await _ensure_row(conn, opportunity_id, user.id)
    await conn.execute(
        update(tracking)
        .where(tracking.c.opportunity_id == opportunity_id)
        .values(**values, updated_by=user.id, updated_at=now())
    )
    (item,) = await _board_items(conn, [opportunity_id])
    return item


@router.post("/api/board/{opportunity_id}/notes", response_model=Note, status_code=201, responses={404: {}})
async def add_note(opportunity_id: OpportunityPath, body: NoteIn, user: User, conn: Db) -> Note:
    await _ensure_row(conn, opportunity_id, user.id)
    t = now()
    note_id = (
        await conn.execute(
            insert(tracking_notes)
            .values(opportunity_id=opportunity_id, author_id=user.id, body=body.body.strip(), created_at=t)
            .returning(tracking_notes.c.id)
        )
    ).scalar_one()
    await conn.execute(
        update(tracking).where(tracking.c.opportunity_id == opportunity_id).values(updated_by=user.id, updated_at=t)
    )
    return Note(id=note_id, author=PersonRef(id=user.id, name=user.name), body=body.body.strip(),
                created_at=t.isoformat())  # fmt: skip


@router.delete("/api/board/{opportunity_id}/notes/{note_id}", status_code=204, responses={403: {}, 404: {}})
async def delete_note(opportunity_id: OpportunityPath, note_id: int, user: User, conn: Db) -> Response:
    """Only the author or an admin."""
    n = (
        await conn.execute(
            select(tracking_notes.c.author_id).where(
                tracking_notes.c.id == note_id, tracking_notes.c.opportunity_id == opportunity_id
            )
        )
    ).first()
    if n is None:
        raise HTTPException(404, detail="Esa nota no existe.")
    if n.author_id != user.id and not user.is_admin:
        raise HTTPException(403, detail="Solo quien escribió la nota (o un administrador) puede borrarla.")
    await conn.execute(delete(tracking_notes).where(tracking_notes.c.id == note_id))
    return Response(status_code=204)


# ---------- organisation settings ----------


async def _settings_row(conn: AsyncConnection, lock: bool = False):  # noqa: ANN202 - a Row
    await conn.execute(pg_insert(org_settings).values(id=1).on_conflict_do_nothing())
    q = select(org_settings).where(org_settings.c.id == 1)
    return (await conn.execute(q.with_for_update() if lock else q)).one()


async def _settings_out(conn: AsyncConnection) -> TeamSettings:
    r = await _settings_row(conn)
    people = await _people(conn)
    return TeamSettings(profile=r.profile, organisms=r.organisms, updated_by=_ref(people, r.updated_by),
                        updated_at=_iso(r.updated_at))  # fmt: skip


@router.get("/api/settings", response_model=TeamSettings)
async def get_settings(_: User, conn: Db) -> TeamSettings:
    return await _settings_out(conn)


@router.put("/api/settings", response_model=TeamSettings)
async def put_settings(body: SettingsPatch, user: User, conn: Db) -> TeamSettings:
    """Partial: only the fields present in the body change. Last write wins (one shared profile)."""
    values: dict[str, Any] = {}
    if "profile" in body.model_fields_set:
        values["profile"] = None if body.profile is None or body.profile.is_neutral() else body.profile.to_json()
    if "organisms" in body.model_fields_set:
        values["organisms"] = body.organisms or None
    if values:
        await _settings_row(conn, lock=True)
        await conn.execute(
            update(org_settings).where(org_settings.c.id == 1).values(**values, updated_by=user.id, updated_at=now())
        )
    return await _settings_out(conn)


# ---------- votes ----------


async def _votes(conn: AsyncConnection, ids: list[str] | None = None) -> list[VoteOut]:
    q = (
        select(votes, users.c.name)
        .join(users, users.c.id == votes.c.user_id)
        .order_by(votes.c.opportunity_id, votes.c.updated_at)
    )
    if ids is not None:
        q = q.where(votes.c.opportunity_id.in_(ids))
    return [
        VoteOut(
            opportunity_id=r.opportunity_id,
            user=PersonRef(id=r.user_id, name=r.name),
            vote=r.vote,
            reason=r.reason,
            updated_at=r.updated_at.isoformat(),
        )  # fmt: skip
        for r in await conn.execute(q)
    ]


@router.get("/api/votes", response_model=VotesResponse)
async def list_votes(_: User, conn: Db) -> VotesResponse:
    """Every vote of the team (a handful of people: the web groups them by call)."""
    return VotesResponse(votes=await _votes(conn))


@router.put("/api/votes/{opportunity_id}", response_model=VoteOut, responses={404: {}})
async def put_vote(opportunity_id: OpportunityPath, body: VoteIn, user: User, conn: Db) -> VoteOut:
    """My vote on a call (one per person and call; voting again replaces it)."""
    if await _snapshot(conn, opportunity_id) is None:
        raise HTTPException(404, detail=UNKNOWN_CALL)
    t, reason = now(), body.reason.strip()
    stmt = pg_insert(votes).values(user_id=user.id, opportunity_id=opportunity_id, vote=body.vote, reason=reason,
                                   updated_at=t)  # fmt: skip
    await conn.execute(
        stmt.on_conflict_do_update(
            index_elements=[votes.c.user_id, votes.c.opportunity_id],
            set_={"vote": body.vote, "reason": reason, "updated_at": t},
        )
    )
    return VoteOut(opportunity_id=opportunity_id, user=PersonRef(id=user.id, name=user.name), vote=body.vote,
                   reason=reason, updated_at=t.isoformat())  # fmt: skip


@router.delete("/api/votes/{opportunity_id}", status_code=204)
async def delete_vote(opportunity_id: OpportunityPath, user: User, conn: Db) -> Response:
    await conn.execute(delete(votes).where(votes.c.user_id == user.id, votes.c.opportunity_id == opportunity_id))
    return Response(status_code=204)


@router.get("/api/votes/disagreements", response_model=DisagreementsResponse)
async def disagreements(_: Admin, conn: Db) -> DisagreementsResponse:
    """Live calls where a vote contradicts the score: "sirve" with score < 40 or "no sirve" with score >= 60, with
    every vote and reason on them. Basis for tuning the scoring weights. Gone calls are left out (no current score).
    """
    all_votes = await _votes(conn)
    if not all_votes:
        return DisagreementsResponse(items=[])
    by_call: dict[str, list[VoteOut]] = {}
    for v in all_votes:
        by_call.setdefault(v.opportunity_id, []).append(v)
    state = await read_state(conn)
    scored = {o.id: o for o in rank([o for o in state.items if o.id in by_call])}
    out = []
    for oid, vs in by_call.items():
        o = scored.get(oid)
        if o is None:
            continue
        low = any(v.vote == "sirve" for v in vs) and o.fit.score < SIRVE_LOW
        high = any(v.vote == "no_sirve" for v in vs) and o.fit.score >= NO_SIRVE_HIGH
        if low or high:
            out.append(Disagreement(opportunity_id=oid, titulo=o.titulo, source=o.source, url=o.url,
                                    score=o.fit.score, tier=o.fit.tier,
                                    kind="ambos" if low and high else "sirve_bajo" if low else "no_sirve_alto",
                                    votes=vs))  # fmt: skip
    out.sort(key=lambda d: -abs(d.score - 50))
    return DisagreementsResponse(items=out)


# ---------- import of a browser's localStorage ----------


@router.post("/api/import", response_model=ImportOut)
async def import_local(body: ImportIn, user: User, conn: Db) -> ImportOut:
    """Merge rule: what the team already saved always wins; the browser's state only fills gaps. A call already on
    the board keeps its row; ids the radar has never seen (not in `opportunities`, gone ones included) are skipped;
    profile and organism filter are imported only if the team never saved them (and the imported value is not
    empty/neutral). Idempotent: a second import changes nothing."""
    imported = kept = skipped = 0
    for oid, e in body.tracking.items():
        if e.status == "nueva":
            continue
        snap = await _snapshot(conn, oid)
        if snap is None:
            exists = (
                await conn.execute(select(tracking.c.opportunity_id).where(tracking.c.opportunity_id == oid))
            ).first()
            kept += exists is not None
            skipped += exists is None
            continue
        res = await conn.execute(
            pg_insert(tracking)
            .values(opportunity_id=oid, status=e.status, updated_by=user.id, updated_at=now(), **snap)
            .on_conflict_do_nothing(index_elements=[tracking.c.opportunity_id])
        )
        if res.rowcount:
            imported += 1
        else:
            kept += 1
    current = await _settings_row(conn, lock=True)
    values: dict[str, Any] = {}
    profile_result: Literal["imported", "kept", "none"] = "none"
    if body.profile is not None and not body.profile.is_neutral():
        profile_result = "kept" if current.profile is not None else "imported"
        if current.profile is None:
            values["profile"] = body.profile.to_json()
    organisms_result: Literal["imported", "kept", "none"] = "none"
    if body.organisms:
        organisms_result = "kept" if current.organisms is not None else "imported"
        if current.organisms is None:
            values["organisms"] = body.organisms
    if values:
        await conn.execute(
            update(org_settings).where(org_settings.c.id == 1).values(**values, updated_by=user.id, updated_at=now())
        )
    log.info("import by user %d: %d tracking rows imported, %d kept, %d skipped; profile %s; organisms %s",
             user.id, imported, kept, skipped, profile_result, organisms_result)  # fmt: skip
    return ImportOut(tracking_imported=imported, tracking_kept=kept, tracking_skipped=skipped,
                     profile=profile_result, organisms=organisms_result)  # fmt: skip
