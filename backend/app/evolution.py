"""Read-only research snapshots and append-only exploration tracking.

Exploration lanes annotate the shared workspace; they do not isolate or restore it.
"""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select
from app.db import Event, Project, Session, Object

router = APIRouter()
FINDING = 'evolution_finding_recorded'
MARKERS = {'evolution_checkpoint', 'evolution_branch_started', 'evolution_branch_closed', 'evolution_branch_focused', FINDING}

class CheckpointInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    note: str = Field(default='', max_length=4000)

class BranchInput(BaseModel):
    checkpoint_id: str
    title: str = Field(min_length=1, max_length=120)

class CloseInput(BaseModel):
    outcome: str = Field(pattern='^(promising|inconclusive|unsupported|paused)$')
    note: str = Field(default='', max_length=4000)


def history(s, pid, markers_only=False):
    q = select(Event).where(Event.project_id == pid)
    if markers_only:
        q = q.where(Event.event_type.in_(MARKERS))
    return s.scalars(q.order_by(Event.project_sequence_number)).all()


def branch_state(events):
    """Replay markers, including older single-lane projects, without rewriting history."""
    focused = None
    opened = {}
    for e in events:
        payload = e.payload or {}
        if e.event_type == 'evolution_branch_started':
            opened[e.id] = {'id': e.id, 'title': payload['title'], 'checkpoint_id': payload['checkpoint_id']}
            focused = e.id
        elif e.event_type == 'evolution_branch_focused':
            target = payload.get('branch_id')
            if target is None or target in opened: focused = target
        elif e.event_type == 'evolution_branch_closed':
            target = payload.get('branch_id')
            opened.pop(target, None)
            if focused == target: focused = None
    return focused, list(opened.values())


def active_branch(events):
    return branch_state(events)[0]


class FindingInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    note: str = Field(min_length=1, max_length=4000)
    outcome: str = Field(default='observation', pattern='^(observation|promising|inconclusive|unsupported)$')
    object_id: str | None = None


class FocusInput(BaseModel):
    branch_id: str | None = None


def view_event(e, titles):
    p = e.payload or {}
    # Avoid shipping legacy imports, full result bodies or snapshot copies on every refresh.
    fields = ('title', 'note', 'outcome', 'checkpoint_id', 'branch_id', 'object_count', 'proposal_id', 'run_id', 'kind', 'action', 'action_type', 'message_id', 'model', 'provider', 'revision', 'source_id')
    return {'id': e.id, 'sequence': e.project_sequence_number, 'type': e.event_type,
            'timestamp': e.timestamp, 'actor': e.actor_type, 'operation_id': e.source_operation_id,
            'objects': [{'id': oid, 'title': titles.get(oid, '')} for oid in e.affected_object_ids],
            'details': {key: p[key] for key in fields if key in p}}

@router.get('/v1/projects/{pid}/evolution')
def evolution(pid: str):
    from app import main as k
    with Session() as s:
        k.get(s, Project, pid)
        titles = {o.id: o.title for o in k.rows(s, Object, pid)}
        events = history(s, pid)
        focused, opened = branch_state(events)
        return {'active_branch': focused, 'open_branches': opened, 'events': [view_event(e, titles) for e in events if e.event_type not in {'project_updated'}]}

@router.post('/v1/projects/{pid}/evolution/checkpoints')
def checkpoint(pid: str, data: CheckpointInput):
    from app import main as k
    with k.transaction() as s:
        p = k.get(s, Project, pid)
        if not data.title.strip(): raise k.Problem('Checkpoint title is required', 422)
        v = k.project_view(s, p)
        snapshot = {key: v[key] for key in ('title', 'description', 'question', 'objects', 'relationships', 'placements')}
        k.event(s, pid, 'evolution_checkpoint', payload={'title': data.title.strip(), 'note': data.note, 'object_count': len(v['objects']), 'snapshot': snapshot})
        s.flush()
        return view_event(history(s, pid, True)[-1], {})

@router.get('/v1/projects/{pid}/evolution/checkpoints/{cid}')
def checkpoint_snapshot(pid: str, cid: str):
    from app import main as k
    with Session() as s:
        e = k.get(s, Event, cid, pid)
        if e.event_type != 'evolution_checkpoint': raise k.Problem('Checkpoint not found', 404)
        return e.payload['snapshot']

@router.post('/v1/projects/{pid}/evolution/branches')
def start_branch(pid: str, data: BranchInput):
    from app import main as k
    with k.transaction() as s:
        k.get(s, Project, pid)
        e = k.get(s, Event, data.checkpoint_id, pid)
        if e.event_type != 'evolution_checkpoint': raise k.Problem('Checkpoint not found', 404)
        if not data.title.strip(): raise k.Problem('Branch title is required', 422)
        k.event(s, pid, 'evolution_branch_started', payload={'title': data.title.strip(), 'checkpoint_id': e.id})
        s.flush()
        return view_event(history(s, pid, True)[-1], {})

@router.post('/v1/projects/{pid}/evolution/branches/{bid}/close')
def close_branch(pid: str, bid: str, data: CloseInput):
    from app import main as k
    with k.transaction() as s:
        k.get(s, Project, pid)
        focused, opened = branch_state(history(s, pid, True))
        if bid not in {b['id'] for b in opened}: raise k.Problem('This exploration lane is not open')
        k.event(s, pid, 'evolution_branch_closed', payload={'branch_id': bid, 'outcome': data.outcome, 'note': data.note})
        s.flush()
        return view_event(history(s, pid, True)[-1], {})


@router.post('/v1/projects/{pid}/evolution/focus')
def focus_branch(pid: str, data: FocusInput):
    from app import main as k
    with k.transaction() as s:
        k.get(s, Project, pid)
        focused, opened = branch_state(history(s, pid, True))
        if data.branch_id is not None and data.branch_id not in {b['id'] for b in opened}:
            raise k.Problem('This exploration lane is not open')
        k.event(s, pid, 'evolution_branch_focused', payload={'branch_id': data.branch_id})
        s.flush()
        return view_event(history(s, pid, True)[-1], {})


@router.post('/v1/projects/{pid}/evolution/branches/{bid}/findings')
def record_finding(pid: str, bid: str, data: FindingInput):
    from app import main as k
    with k.transaction() as s:
        k.get(s, Project, pid)
        _, opened = branch_state(history(s, pid, True))
        if bid not in {b['id'] for b in opened}:
            raise k.Problem('This exploration lane is not open')
        if not data.title.strip() or not data.note.strip():
            raise k.Problem('Finding title and notes are required', 422)
        obj = k.get(s, Object, data.object_id, pid) if data.object_id else None
        payload = {'branch_id': bid, 'title': data.title.strip(), 'note': data.note.strip(), 'outcome': data.outcome}
        if obj is not None:
            payload['revision'] = obj.current_revision
        k.event(s, pid, FINDING, ids=[obj.id] if obj is not None else [], payload=payload)
        s.flush()
        return view_event(history(s, pid, True)[-1], {obj.id: obj.title} if obj is not None else {})


@router.get('/v1/projects/{pid}/evolution/focus')
def get_focus(pid: str):
    from app import main as k
    with Session() as s:
        k.get(s, Project, pid)
        focused, opened = branch_state(history(s, pid, True))
        return {'active_branch': focused, 'open_branches': opened}
