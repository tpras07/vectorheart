import hashlib
import json
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select, delete, text
from sqlalchemy.exc import SQLAlchemyError
from app.db import Session, Project, Object, Revision, Relationship, Placement, Operation, Specification, Run, Evidence, Event, uid, now
from app.science import ADAPTER, Parameters, predictions, validate_result, LIMITATIONS

app = FastAPI(title='VectorHeart local scientific kernel', version='0.1.0')
lock = threading.RLock()
runner = threading.BoundedSemaphore(1)
class Problem(Exception):
    def __init__(self, message, status=409): self.message, self.status = message, status
@app.exception_handler(Problem)
async def problem(_, exc): return JSONResponse({'error': {'message': exc.message}}, status_code=exc.status)
@app.exception_handler(RequestValidationError)
async def invalid(_, exc): return JSONResponse({'error': {'message': str(exc)}}, status_code=422)
@app.exception_handler(ValidationError)
async def invalid_model(_, exc): return JSONResponse({'error': {'message': str(exc)}}, status_code=422)
@app.exception_handler(SQLAlchemyError)
async def database_error(_,exc):return JSONResponse({'error':{'message':'Database transaction could not complete. Check migrations and record identities; no partial transaction was committed.'}},status_code=409)
@app.middleware('http')
async def local_only(request: Request, call_next):
    origin = request.headers.get('origin')
    if origin and origin not in ['http://localhost:3000', 'http://127.0.0.1:3000']:
        return JSONResponse({'error': {'message': 'Local service rejects browser cross-origin requests'}}, status_code=403)
    return await call_next(request)
@contextmanager
def transaction():
    with lock, Session() as s:
        s.execute(text('BEGIN IMMEDIATE'))
        try: yield s; s.commit()
        except Exception: s.rollback(); raise
def get(s, cls, id, pid=None):
    value = s.get(cls, id)
    if not value or (pid and value.project_id != pid) or (isinstance(value, Object) and value.deleted): raise Problem('Record not found', 404)
    return value
def rows(s, cls, pid): return s.scalars(select(cls).where(cls.project_id == pid)).all()
def validate_revision_source(s,pid,target_id,source_id):
    evidence=s.get(Evidence,source_id)
    if evidence:
        if evidence.project_id!=pid or target_id not in evidence.target_hypothesis_ids:raise Problem('Revision evidence is not linked to this hypothesis',422)
        return
    from app.literature import validate_revision_claim
    validate_revision_claim(s,pid,target_id,source_id)
def dump(value):
    return {column.key: getattr(value, column.key) for column in value.__mapper__.column_attrs}
def event(s, pid, kind, ids=None, payload=None, operation=None, actor='human'):
    p = get(s, Project, pid); p.sequence += 1; p.updated_at = now()
    s.add(Event(project_id=pid, project_sequence_number=p.sequence, event_type=kind, actor_type=actor, source_operation_id=operation, affected_object_ids=ids or [], payload=payload or {}, timestamp=now()))
def revise(s, obj, title, body, metadata=None, reason='Notebook save', actor='human'):
    metadata = obj.scientific_metadata if metadata is None else metadata
    previous = s.scalar(select(Revision).where(Revision.object_id == obj.id).order_by(Revision.revision_number.desc()))
    if previous and title == obj.title and body == obj.body and metadata == obj.scientific_metadata: return
    obj.current_revision = previous.revision_number + 1 if previous else 1
    obj.title, obj.body, obj.scientific_metadata, obj.updated_at = title, body, metadata, now()
    s.add(Revision(object_id=obj.id, revision_number=obj.current_revision, title_snapshot=title, body_snapshot=body, metadata_snapshot=metadata, previous_revision_id=previous.revision_id if previous else None, actor_type=actor, created_at=now(), reason=reason))
def apply_hypothesis_revision(s,target,payload,operation_id,provenance=None):
    if target.current_revision!=payload['base_revision']:raise Problem('Hypothesis changed since proposal')
    metadata={**target.scientific_metadata,'statement':payload['proposed_statement'],'epistemic_status':'unresolved','revision_scope':payload['scope'],'remaining_uncertainties':payload['remaining_uncertainties']}
    if provenance:metadata['model_provenance']=provenance
    revise(s,target,target.title,payload['proposed_statement'],metadata,payload['rationale'])
    for eid in payload['evidence_ids']:relationship(s,target.project_id,{'sourceId':target.id,'targetId':eid,'type':'derived_from','evidence_id':eid})
    event(s,target.project_id,'revision_accepted',[target.id],operation=operation_id)
def apply_hypothesis_construction(s,pid,target,payload,provenance=None,title=None):
    metadata={**payload,'epistemic_status':'proposed'}
    if provenance:metadata['model_provenance']=provenance
    obj=add_object(s,pid,'hypothesis',title or payload['statement'],payload['statement'],metadata,actor='model' if provenance else 'human')
    relationship(s,pid,{'sourceId':obj.id,'targetId':target.id,'type':'derived_from'})
    return obj
def add_object(s, pid, typ, title, body, metadata=None, id=None, actor='human'):
    if typ.lower()=='hypothesis':
        metadata={'statement':body,'assumptions':[],'predicted_outcomes':[],'limitations':[],'epistemic_status':'proposed',**(metadata or {})}
        if metadata['epistemic_status'] not in ['proposed','unresolved','conditionally_supported','challenged','rejected_within_scope']:raise Problem('Invalid epistemic status',422)
    obj = Object(id=id or uid(), project_id=pid, object_type=typ.lower(), title=title, body=body, scientific_metadata=metadata or {}, created_at=now(), updated_at=now(), provenance_type=actor)
    s.add(obj); s.flush(); revise(s,obj,title,body,metadata or {}, 'Created',actor); s.flush()
    event(s,pid,'object_created',[obj.id],actor=actor)
    return obj
TYPES = Literal['Note','Question','Hypothesis','Observation','Prediction','Experiment','Evidence','Concept']
class Contract(BaseModel): model_config = ConfigDict(extra='allow', allow_inf_nan=False)
class ObjectInput(Contract):
    id: str = Field(default_factory=uid, min_length=1, max_length=200)
    projectId: str
    type: TYPES
    title: str = Field(max_length=10000)
    body: str = Field(max_length=1000000)
    metadata: dict = Field(default_factory=dict)
class ProjectInput(Contract):
    id: str = Field(default_factory=uid, min_length=1, max_length=200)
    title: str = Field(min_length=1,max_length=120)
    description: str = Field(default='',max_length=10000)
    settings: dict = Field(default_factory=dict)
    question: str = ''
    lastVisitedView: Literal['notebook','canvas'] | None = None
    objects: list[ObjectInput] = Field(default_factory=list)
    placements: list[dict] = Field(default_factory=list)
    relationships: list[dict] = Field(default_factory=list)
class ImportInput(Contract):
    projects: list[ProjectInput]
    original_backup:dict=Field(default_factory=dict)
class ProjectPatch(Contract):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    title:str|None=Field(default=None,min_length=1,max_length=120)
    description:str|None=Field(default=None,max_length=10000)
    question:str|None=Field(default=None,max_length=100000)
    settings:dict|None=None
    lastVisitedView:Literal['notebook','canvas']|None=None
class ObjectPatch(Contract):
    model_config=ConfigDict(extra='forbid')
    title:str|None=Field(default=None,max_length=10000)
    body:str|None=Field(default=None,max_length=1000000)
    type:TYPES|None=None
    def model_post_init(self,context):
        if any(getattr(self,key) is None for key in self.model_fields_set):raise ValueError('Content fields cannot be null')
def project_view(s,p):
    return {'id':p.id,'title':p.title,'description':p.description,'createdAt':p.created_at,'updatedAt':p.updated_at,'settings':p.settings,'question':p.question,'lastVisitedView':p.last_visited_view,'objects':[object_view(o) for o in rows(s,Object,p.id) if not o.deleted], 'placements':[{'objectId':v.object_id,'position':{'x':v.x,'y':v.y}} for v in rows(s,Placement,p.id)],'relationships':[{'id':r.id,'projectId':p.id,'sourceId':r.source_object_id,'targetId':r.target_object_id,'type':r.relationship_type,'details':r.details} for r in rows(s,Relationship,p.id)]}
def object_view(o): return {'id':o.id,'projectId':o.project_id,'type':o.object_type.capitalize(),'title':o.title,'body':o.body,'createdAt':o.created_at,'updatedAt':o.updated_at,'metadata':o.scientific_metadata,'currentRevision':o.current_revision,'provenanceType':o.provenance_type}
def add_project(s,p):
    if not p.title.strip(): raise Problem('Title is required',422)
    value=Project(id=p.id,title=p.title,description=p.description,created_at=p.model_extra.get('createdAt',now()),updated_at=now(),settings=p.settings,question=p.question,last_visited_view=p.lastVisitedView)
    s.add(value);s.flush();event(s,p.id,'project_created');return value
def relationship(s,pid,r):
    source,target=r.get('sourceId'),r.get('targetId')
    get(s,Object,source,pid);get(s,Object,target,pid)
    if source==target: raise Problem('Self connections are not supported',422)
    typ=r.get('type') or 'related_to'
    if typ not in ['supports','challenges','derived_from','tests','produces','related_to']: raise Problem('Unsupported relationship type',422)
    existing=s.scalar(select(Relationship).where(Relationship.project_id==pid,Relationship.source_object_id==source,Relationship.target_object_id==target,Relationship.relationship_type==typ))
    if existing:return existing
    value=Relationship(id=r.get('id') or uid(),project_id=pid,source_object_id=source,target_object_id=target,relationship_type=typ,evidence_id=r.get('evidence_id'),created_at=now(),details={})
    s.add(value);s.flush();return value
@app.get('/v1/health')
def health():
    from app.model_providers import capabilities
    return {'status':'ok','schema_version':1,'capabilities':[ADAPTER,'manual_proposals','research_intelligence'],'providers':{'manual':'available',**{p['provider']:'credential configured' if p['credentials_configured'] else 'unavailable' for p in capabilities()}}}
@app.get('/v1/projects')
def projects():
    with Session() as s:return [project_view(s,p) for p in s.scalars(select(Project))]
@app.post('/v1/projects')
def create_project(p:ProjectInput):
    with transaction() as s:return project_view(s,add_project(s,p))
@app.get('/v1/projects/{pid}')
def read_project(pid:str):
    with Session() as s:return project_view(s,get(s,Project,pid))
@app.patch('/v1/projects/{pid}')
def patch_project(pid:str,patch:ProjectPatch):
    patch=patch.model_dump(exclude_unset=True)
    if any(value is None for key,value in patch.items() if key!='lastVisitedView'):raise Problem('Project fields cannot be null',422)
    with transaction() as s:
        p=get(s,Project,pid)
        for key in ['title','description','question','settings','lastVisitedView']:
            if key in patch:
                if key=='title' and (not isinstance(patch[key],str) or not patch[key].strip()):raise Problem('Invalid title',422)
                setattr(p,'last_visited_view' if key=='lastVisitedView' else key,patch[key])
        event(s,pid,'project_updated');return project_view(s,p)
@app.delete('/v1/projects/{pid}')
def remove_project(pid:str):
    # Preserve historical records; hide project via a tombstone setting.
    with transaction() as s:
        p=get(s,Project,pid);p.settings={**p.settings,'archived':True};event(s,pid,'project_archived');return {'ok':True}
@app.post('/v1/import')
def import_projects(data:ImportInput):
    warnings=[];imported=[]
    with transaction() as s:
        for p in data.projects:
            if s.get(Project,p.id):continue
            add_project(s,p)
            for o in p.objects:
                if o.projectId!=p.id or s.get(Object,o.id):raise Problem('Import object ID/ownership collision',422)
                value=add_object(s,p.id,o.type,o.title,o.body,{**o.metadata,'legacy_record':o.model_dump()},o.id,'import_process')
                value.created_at=o.model_extra.get('createdAt',now())
            for r in p.relationships:
                if not all(s.get(Object,r.get(k)) and s.get(Object,r[k]).project_id==p.id for k in ['sourceId','targetId']):warnings.append('Skipped dangling relationship '+str(r.get('id')));continue
                relationship(s,p.id,r)
            for v in p.placements:
                if not s.get(Object,v.get('objectId')) or s.get(Object,v['objectId']).project_id!=p.id:warnings.append('Skipped missing or foreign placement');continue
                position=Position.model_validate(v['position']);s.add(Placement(object_id=v['objectId'],project_id=p.id,x=position.x,y=position.y))
            event(s,p.id,'legacy_import',payload={'original_record':p.model_dump(),'original_backup':data.original_backup},actor='import_process');imported.append(p.id)
    return {'imported':imported,'warnings':warnings}
@app.get('/v1/projects/{pid}/objects')
def objects(pid:str):
    with Session() as s:get(s,Project,pid);return [object_view(o) for o in rows(s,Object,pid) if not o.deleted]
@app.post('/v1/projects/{pid}/objects')
def create_object(pid:str,data:ObjectInput):
    with transaction() as s:
        get(s,Project,pid)
        if data.type in ['Experiment','Evidence']:raise Problem('Experiment and Evidence objects are created only by validated execution',422)
        if data.projectId!=pid:raise Problem('Project mismatch',422)
        existing=s.get(Object,data.id)
        if existing:return object_view(get(s,Object,data.id,pid))
        return object_view(add_object(s,pid,data.type,data.title,data.body,data.metadata,data.id))
@app.get('/v1/projects/{pid}/objects/{oid}')
def read_object(pid:str,oid:str):
    with Session() as s:return object_view(get(s,Object,oid,pid))
@app.patch('/v1/projects/{pid}/objects/{oid}')
def patch_object(pid:str,oid:str,data:ObjectPatch):
    data=data.model_dump(exclude_unset=True)
    with transaction() as s:
        o=get(s,Object,oid,pid)
        if o.object_type in ['evidence','experiment'] or o.scientific_metadata.get('literature_source_id'):raise Problem('Recorded experiment/source artifacts and reviewed literature claims are immutable; use a new review instead.')
        if 'type' in data and data['type'].lower()!=o.object_type:
            if o.object_type not in ['note','question','hypothesis','observation'] or data['type'] not in ['Note','Question','Hypothesis','Observation']:raise Problem('Recorded scientific artifact types are immutable')
            o.object_type=data['type'].lower()
        metadata={**o.scientific_metadata,'statement':data['body']} if o.object_type=='hypothesis' and 'body' in data else o.scientific_metadata
        revise(s,o,data.get('title',o.title),data.get('body',o.body),metadata);event(s,pid,'object_revised',[oid]);return object_view(o)
@app.delete('/v1/projects/{pid}/objects/{oid}')
def remove_object(pid:str,oid:str):
    with transaction() as s:
        o=get(s,Object,oid,pid);o.deleted=True
        s.execute(delete(Placement).where(Placement.object_id==oid));s.execute(delete(Relationship).where((Relationship.source_object_id==oid)|(Relationship.target_object_id==oid)))
        event(s,pid,'object_removed',[oid]);return {'ok':True}
@app.get('/v1/projects/{pid}/objects/{oid}/revisions')
def revisions(pid:str,oid:str):
    with Session() as s:get(s,Object,oid,pid);return [dump(r) for r in s.scalars(select(Revision).where(Revision.object_id==oid).order_by(Revision.revision_number))]
@app.get('/v1/projects/{pid}/relationships')
def relationships(pid:str):
    with Session() as s:return [dump(r) for r in rows(s,Relationship,pid)]
@app.post('/v1/projects/{pid}/relationships')
def create_relationship(pid:str,data:dict):
    with transaction() as s:
        r=relationship(s,pid,data);event(s,pid,'relationship_created',[r.source_object_id,r.target_object_id]);return dump(r)
@app.delete('/v1/projects/{pid}/relationships/{rid}')
def remove_relationship(pid:str,rid:str):
    with transaction() as s:
        r=s.get(Relationship,rid)
        if r:get(s,Relationship,rid,pid);s.delete(r);event(s,pid,'relationship_removed')
        return {'ok':True}
class Position(Contract): x:float;y:float
@app.get('/v1/projects/{pid}/canvas')
def canvas(pid:str):
    with Session() as s:return [dump(v) for v in rows(s,Placement,pid)]
@app.put('/v1/projects/{pid}/canvas/{oid}')
def place(pid:str,oid:str,p:Position):
    with transaction() as s:
        get(s,Object,oid,pid);v=s.get(Placement,oid)
        if v:v.x,v.y=p.x,p.y
        else:s.add(Placement(object_id=oid,project_id=pid,x=p.x,y=p.y))
        return {'ok':True}
@app.delete('/v1/projects/{pid}/canvas/{oid}')
def unplace(pid:str,oid:str):
    with transaction() as s:get(s,Object,oid,pid);s.execute(delete(Placement).where(Placement.object_id==oid));return {'ok':True}

class Construct(Contract):
    model_config=ConfigDict(extra='forbid')
    statement:str=Field(min_length=1,max_length=10000)
    assumptions:list[str]=Field(default_factory=list)
    predicted_outcomes:list[str]=Field(default_factory=list)
    limitations:list[str]=Field(default_factory=list)
class TestHypothesis(Contract):
    model_config=ConfigDict(extra='forbid')
    adapter_id:Literal['toy.causal_intervention.v1']=ADAPTER
    parameters:Parameters=Field(default_factory=Parameters)
    rationale:str=Field(default='Distinguish the two registered synthetic causal models by intervention.')
class Modify(Contract):
    model_config=ConfigDict(extra='forbid')
    original_statement:str
    proposed_statement:str=Field(min_length=1,max_length=10000)
    evidence_ids:list[str]=Field(min_length=1)
    assumptions_changed:list[str]=Field(default_factory=list)
    scope:str
    remaining_uncertainties:list[str]
    rationale:str
REGISTRY={'construct.hypothesis_from_note':(Construct,['note','question']), 'destroy.test_hypothesis':(TestHypothesis,['hypothesis']), 'modify.propose_hypothesis_revision':(Modify,['hypothesis'])}
class Proposal(Contract):
    action_type:str
    target_object_ids:list[str]=Field(min_length=1,max_length=1)
    proposal_payload:dict
def propose(s,pid,data):
    if data.action_type not in REGISTRY:raise Problem('Unregistered action',422)
    _,types=REGISTRY[data.action_type]
    from app.providers import ManualProvider
    provider=ManualProvider()
    method={'construct.hypothesis_from_note':provider.formalize_hypothesis,'destroy.test_hypothesis':provider.propose_experiment,'modify.propose_hypothesis_revision':provider.propose_revision}[data.action_type]
    payload=method(data.proposal_payload).model_dump()
    target=get(s,Object,data.target_object_ids[0],pid)
    if target.object_type not in types:raise Problem('Unsupported target type',422)
    if data.action_type.startswith('destroy') and not target.scientific_metadata.get('causal_demo'):raise Problem('This adapter only tests the registered synthetic A/B scenario. Proposed experiment — execution not available for this hypothesis.',422)
    if data.action_type.startswith('modify'):
        if payload['original_statement']!=target.body:raise Problem('Original statement is stale')
        for eid in payload['evidence_ids']:
            validate_revision_source(s,pid,target.id,eid)
        payload['base_revision']=target.current_revision
    op=Operation(id=uid(),project_id=pid,kind=data.action_type.split('.')[0],action_type=data.action_type,target_object_ids=data.target_object_ids,proposal_payload=payload,rationale=payload.get('rationale','Human construction'),assumptions=payload.get('assumptions',[]),created_at=now(),updated_at=now(),status='draft')
    s.add(op);s.flush()
    if op.kind=='destroy':
        p=Parameters.model_validate(payload['parameters']);spec={'adapter_id':ADAPTER,'adapter_version':'1','parameters':p.model_dump(),'predicted_outcomes':predictions(p),'measurement_plan':'Sample Y under do(X=x0); mean, sample SD, standard error and approximate 95% CI.','validation_plan':['count','finite','statistics','checksum','analytical predictions','interval','compatibility'],'execution_limits':{'timeout_seconds':15,'max_samples':5000,'concurrency':1},'environment_type':'local_trusted_subprocess'}
        s.add(Specification(project_id=pid,operation_id=op.id,created_at=now(),specification_hash=hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest(),**spec))
    event(s,pid,'operation_proposed',data.target_object_ids,operation=op.id);return op
@app.get('/v1/projects/{pid}/operations')
def operations(pid:str):
    with Session() as s:return [operation_view(s,o) for o in rows(s,Operation,pid)]
def operation_view(s,o):
    spec=s.scalar(select(Specification).where(Specification.operation_id==o.id));return {**dump(o),'specification':dump(spec) if spec else None}
@app.post('/v1/projects/{pid}/operations')
def create_operation(pid:str,data:Proposal):
    with transaction() as s:return operation_view(s,propose(s,pid,data))
@app.get('/v1/projects/{pid}/operations/{oid}')
def read_operation(pid:str,oid:str):
    with Session() as s:return operation_view(s,get(s,Operation,oid,pid))
@app.post('/v1/projects/{pid}/operations/{oid}/approve')
def approve(pid:str,oid:str):
    with transaction() as s:
        o=get(s,Operation,oid,pid)
        if o.status!='draft':raise Problem('Only draft operations can be approved')
        if o.kind=='modify' and get(s,Object,o.target_object_ids[0],pid).current_revision!=o.proposal_payload['base_revision']:raise Problem('Hypothesis changed; propose a new revision')
        o.status='approved';o.approval_record={'actor':'human','timestamp':now()};o.updated_at=now()
        spec=s.scalar(select(Specification).where(Specification.operation_id==oid))
        if spec:spec.approved_at=now()
        event(s,pid,'operation_approved',o.target_object_ids,operation=oid);return operation_view(s,o)
@app.post('/v1/projects/{pid}/operations/{oid}/reject')
def reject(pid:str,oid:str):
    with transaction() as s:
        o=get(s,Operation,oid,pid)
        if o.status!='draft':raise Problem('Only draft operations can be rejected')
        o.status='rejected';event(s,pid,'operation_rejected',o.target_object_ids,operation=oid);return dump(o)
@app.post('/v1/projects/{pid}/operations/{oid}/execute')
def execute(pid:str,oid:str):
    if not runner.acquire(blocking=False):raise Problem('Local runner is busy; retry shortly',429)
    try:return execute_locked(pid,oid)
    finally:runner.release()
def execute_locked(pid,oid):
    with transaction() as s:
        o=get(s,Operation,oid,pid)
        if o.status=='completed':return dump(o)
        if o.status!='approved':raise Problem('Explicit approval is required before execution')
        o.status='running';o.updated_at=now();event(s,pid,'operation_running',o.target_object_ids,operation=oid,actor='kernel')
        if o.kind=='destroy':
            spec=s.scalar(select(Specification).where(Specification.operation_id==oid))
            frozen={k:getattr(spec,k) for k in ['adapter_id','adapter_version','parameters','predicted_outcomes','measurement_plan','validation_plan','execution_limits','environment_type']}
            if not spec.approved_at or hashlib.sha256(json.dumps(frozen,sort_keys=True).encode()).hexdigest()!=spec.specification_hash:raise Problem('Approved specification integrity check failed')
            run=Run(id=uid(),experiment_specification_id=spec.id,project_id=pid,status='running',started_at=now(),actual_parameters=spec.parameters,code_version='toy.causal_intervention.v1',random_seed=spec.parameters['seed']);s.add(run);o.execution_id=run.id
        else:run=None
        payload=o.proposal_payload;kind=o.kind;target_id=o.target_object_ids[0]
    started=time.monotonic()
    try:
        result=None
        if kind=='destroy':
            child=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'workers/causal_intervention.py')],input=json.dumps(payload['parameters']),text=True,capture_output=True,timeout=15, shell=False)
            if child.returncode:raise RuntimeError(child.stderr[:2000])
            result=json.loads(child.stdout);checks=validate_result(result,payload['parameters'])
        with transaction() as s:
            o=get(s,Operation,oid,pid);target=get(s,Object,target_id,pid)
            if kind=='construct':
                apply_hypothesis_construction(s,pid,target,payload)
            elif kind=='modify':
                apply_hypothesis_revision(s,target,payload,oid)
            else:
                run=get(s,Run,o.execution_id,pid);run.status='completed';run.completed_at=now();run.duration_ms=int((time.monotonic()-started)*1000);run.measured_outputs=result;run.environment_metadata=result['environment'];run.validation_results=checks;run.artifact_references=[{'kind':'embedded_samples','checksum':result['checksum'],'count':len(result['samples'])}]
                experiment=add_object(s,pid,'experiment','Intervention do(X = '+str(payload['parameters']['intervention_value'])+')','Synthetic causal intervention; see recorded run.',{'run_id':run.id,'parameters':payload['parameters']},actor='experiment_runner')
                interpretation='Simulation mean compatibility (95% approximate interval): '+str(result['compatible'])+'. Configured world '+payload['parameters']['data_generating_world']+'.'
                evidence=add_object(s,pid,'evidence','Simulated intervention evidence',interpretation,{'run_id':run.id,'source_type':'simulation','verification_status':'execution_checked','limitations':LIMITATIONS},actor='experiment_runner')
                s.add(Evidence(id=evidence.id,project_id=pid,source_run_id=run.id,source_type='simulation',target_hypothesis_ids=[target.id],measured_results={k:v for k,v in result.items() if k!='samples'},interpretation=interpretation,verification_status='execution_checked',limitations=LIMITATIONS,created_at=now(),provenance={'adapter':ADAPTER,'parameters':payload['parameters'],'environment':result['environment'],'checksum':result['checksum']}))
                relationship(s,pid,{'sourceId':experiment.id,'targetId':target.id,'type':'tests'});relationship(s,pid,{'sourceId':experiment.id,'targetId':evidence.id,'type':'produces'})
                world=target.scientific_metadata.get('candidate_world','A');relationship(s,pid,{'sourceId':evidence.id,'targetId':target.id,'type':'supports' if result['compatible'][world] else 'challenges','evidence_id':evidence.id})
                event(s,pid,'experiment_completed',[experiment.id],operation=oid,actor='experiment_runner');event(s,pid,'evidence_recorded',[evidence.id,target.id],operation=oid,actor='kernel')
            o.status='completed';o.updated_at=now();event(s,pid,'operation_completed',[target_id],operation=oid,actor='kernel');return dump(o)
    except Exception as exc:
        with transaction() as s:
            o=get(s,Operation,oid,pid);o.status='failed';o.updated_at=now()
            if o.execution_id:
                r=get(s,Run,o.execution_id,pid);r.status='failed';r.completed_at=now();r.errors=[str(exc)];r.duration_ms=int((time.monotonic()-started)*1000)
            event(s,pid,'operation_failed',[target_id],{'error':str(exc)},oid,'kernel')
        raise Problem('Execution failed: '+str(exc),422)
@app.get('/v1/adapters')
def adapters():
    from app.science import NumericalResult
    return [{'id':ADAPTER,'version':'1','parameter_schema':Parameters.model_json_schema(),'output_schema':NumericalResult.model_json_schema(),'domain':'Registered synthetic A/B causal models only; requires causal_demo target metadata','approval_required':True,'execution_limits':{'timeout_seconds':15,'sample_count_max':5000,'concurrency':1},'limitations':LIMITATIONS}]
@app.post('/v1/projects/{pid}/operations/{oid}/retry')
def retry(pid:str,oid:str):
    with transaction() as s:
        original=get(s,Operation,oid,pid)
        if original.status!='failed':raise Problem('Only failed operations can be retried')
        payload={k:v for k,v in original.proposal_payload.items() if k!='base_revision'}
        new=propose(s,pid,Proposal(action_type=original.action_type,target_object_ids=original.target_object_ids,proposal_payload=payload))
        event(s,pid,'retry_proposed',original.target_object_ids,{'original_operation_id':oid,'new_operation_id':new.id},new.id)
        return operation_view(s,new)
@app.get('/v1/projects/{pid}/runs/{rid}/artifacts')
def artifacts(pid:str,rid:str):
    with Session() as s:return get(s,Run,rid,pid).artifact_references
@app.get('/v1/projects/{pid}/runs')
def runs(pid:str):
    with Session() as s:return [dump(r) for r in rows(s,Run,pid)]
@app.get('/v1/projects/{pid}/runs/{rid}')
def read_run(pid:str,rid:str):
    with Session() as s:return dump(get(s,Run,rid,pid))
@app.get('/v1/projects/{pid}/evidence')
def evidence(pid:str):
    with Session() as s:return [dump(e) for e in rows(s,Evidence,pid)]
@app.get('/v1/projects/{pid}/events')
def events(pid:str,after:int=0,limit:int=100):
    with Session() as s:return [dump(e) for e in s.scalars(select(Event).where(Event.project_id==pid,Event.project_sequence_number>after).order_by(Event.project_sequence_number).limit(min(max(limit,1),500)))]
@app.post('/v1/projects/{pid}/demo')
def demo(pid:str):
    with transaction() as s:
        get(s,Project,pid)
        if any(o.scientific_metadata.get('causal_demo') for o in rows(s,Object,pid)):raise Problem('First Heartbeat already exists in this project')
        add_object(s,pid,'question','Observational equivalence','Can passive observations distinguish whether X causes Y or Y causes X?',{'causal_demo':True})
        for world,statement in [('A','X directly causes Y under Model A.'),('B','Y directly causes X under Model B.')]:
            o=add_object(s,pid,'hypothesis','Hypothesis '+world,statement,{'causal_demo':True,'candidate_world':world,'statement':statement,'assumptions':['Independent standard-normal noise','Both observational covariance matrices are [[1,0.8],[0.8,1]]'],'predicted_outcomes':['Under do(X=2), A mean Y=1.6; B mean Y=0'],'limitations':LIMITATIONS,'epistemic_status':'proposed'})
            if world=='A':propose(s,pid,Proposal(action_type='destroy.test_hypothesis',target_object_ids=[o.id],proposal_payload={}))
        event(s,pid,'first_heartbeat_created');return {'ok':True}

from app.intelligence import router as intelligence_router
app.include_router(intelligence_router)

from app.stage3 import router as stage3_router
app.include_router(stage3_router)

from app.literature import router as literature_router
app.include_router(literature_router)

from app.evolution import router as evolution_router
app.include_router(evolution_router)
