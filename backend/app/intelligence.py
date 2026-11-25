import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import ValidationError
from sqlalchemy import select
from app.db import Session,Object,Evidence,Project,Relationship,uid,now
from app.intelligence_models import ResearchConversation,ResearchMessage,ResearchProposal
from app.intelligence_schemas import TurnRequest,ScientificProposal,ResearchIntelligenceResponse,SYSTEM_PROMPT,PROMPT_VERSION,MODE_ROLES,proposal_contract
from app.model_providers import route,capabilities,ModelRequest,ProviderError,safe_error
from app.research_context import ResearchContextBuilder
from app.science import ADAPTER,Parameters
from app.proposal_correction import correct_proposals

router=APIRouter()
inference_slots=threading.BoundedSemaphore(2)
def services():
    from app import main
    return main
def proposal_view(p):return {**services().dump(p)}
def message_view(s,m):return {**services().dump(m),'proposals':[proposal_view(p) for p in s.scalars(select(ResearchProposal).where(ResearchProposal.source_message_id==m.id).order_by(ResearchProposal.created_at,ResearchProposal.id))]}
def conversation(s,pid,cid):
    k=services();k.get(s,Project,pid);return k.get(s,ResearchConversation,cid,pid)
def recover_interrupted(s,cid):
    for m in s.scalars(select(ResearchMessage).where(ResearchMessage.conversation_id==cid,ResearchMessage.status=='running')):
        if (datetime.now(timezone.utc)-datetime.fromisoformat(m.created_at)).total_seconds()>180:
            m.status='failed';m.content='The inference request was interrupted or expired. Send again to retry.';m.response_details={'error_code':'interrupted'}
def validated_proposal(s,pid,p,context):
    k=services();included={o['id']:o for o in context['objects']}
    refs=set(p.referenced_object_ids+p.evidence_ids+([p.target_object_id] if p.target_object_id else [])+([p.source_object_id] if p.source_object_id else []))
    if not refs.issubset(included):raise ValueError('Proposal references objects outside supplied context')
    for oid in refs:k.get(s,Object,oid,pid)
    if p.literature_source_ids:
        from app.literature import scoped_snapshot
        supplied={v['source_id']:v for v in context.get('literature',[])}
        for sid in p.literature_source_ids:
            if sid not in supplied:raise ValueError('Literature citation was not supplied in this research context.')
            scoped_snapshot(s,pid,sid,supplied[sid]['snapshot_id'])
    target=k.get(s,Object,p.target_object_id,pid) if p.target_object_id else None
    if p.action_type=='propose_relationship':
        if not p.source_object_id or not p.target_object_id or not p.relationship_type:raise ValueError('Choose two existing research objects and a supported relationship type.')
        if p.source_object_id==p.target_object_id:raise ValueError('A relationship needs two different research objects.')
        from app.stage3 import relationship_blocked
        if relationship_blocked(s,pid,p.source_object_id,p.target_object_id,p.relationship_type):raise ValueError('The researcher rejected this relationship. Explicit human reconnection is required.')
    elif p.source_object_id or p.relationship_type:raise ValueError('Relationship endpoints and type apply only to relationship proposals.')
    if p.action_type in ['propose_experiment','propose_revision'] and (not target or target.object_type!='hypothesis'):raise ValueError('Proposal requires a hypothesis target')
    payload=p.model_dump()
    payload['executable']=False
    if p.action_type=='propose_experiment':
        if p.adapter_id==ADAPTER:
            if p.adapter_parameters is None:raise ValueError('Missing adapter parameters')
            try:Parameters.model_validate(p.adapter_parameters.model_dump())
            except ValidationError:raise ValueError('The causal intervention needs world A or B, X between -5 and 5, 100–5000 samples, and a nonnegative 32-bit seed. No parameters were changed.')
            payload['executable']=bool(target.scientific_metadata.get('causal_demo'))
        payload['execution_notice']='Separate specification approval required' if payload['executable'] else 'Conceptual experiment — execution not yet available.'
    if p.action_type=='propose_revision':
        if not p.evidence_ids:raise ValueError('Revision needs linked measured evidence; discuss unevidenced revisions without a mutation proposal')
        for eid in p.evidence_ids:
            k.validate_revision_source(s,pid,target.id,eid)
        if target.current_revision!=included[target.id]['revision_number']:raise ValueError('Hypothesis changed during inference')
        payload['base_revision']=target.current_revision;payload['original_statement']=target.body
    return payload

@router.get('/v1/intelligence/providers')
def providers():return {'providers':capabilities(),'priority':os.getenv('VECTORHEART_PROVIDER_PRIORITY','OpenAI,Google Gemini,Anthropic').split(','),'live_connectivity_verified':False}
@router.get('/v1/projects/{pid}/intelligence/conversations')
def conversations(pid:str):
    k=services()
    with Session() as s:k.get(s,Project,pid);return [k.dump(c) for c in s.scalars(select(ResearchConversation).where(ResearchConversation.project_id==pid))]
@router.post('/v1/projects/{pid}/intelligence/conversations')
def create_conversation(pid:str):
    k=services()
    with k.transaction() as s:
        k.get(s,Project,pid);c=s.scalar(select(ResearchConversation).where(ResearchConversation.project_id==pid))
        if not c:c=ResearchConversation(id=uid(),project_id=pid);s.add(c);s.flush()
        return k.dump(c)
@router.get('/v1/projects/{pid}/intelligence/conversations/{cid}')
def read_conversation(pid:str,cid:str):
    k=services()
    with k.transaction() as s:
        c=conversation(s,pid,cid)
        recover_interrupted(s,cid)
        return {**k.dump(c),'messages':[message_view(s,m) for m in s.scalars(select(ResearchMessage).where(ResearchMessage.conversation_id==cid).order_by(ResearchMessage.created_at,ResearchMessage.id))]}
@router.post('/v1/projects/{pid}/intelligence/conversations/{cid}/turns')
def turn(pid:str,cid:str,data:TurnRequest):
    return perform_turn(pid,cid,data)

def perform_turn(pid,cid,data,context_override=None,instructions='',run_provenance=None):
    k=services();digest=hashlib.sha256(data.model_dump_json().encode()).hexdigest()
    with k.transaction() as s:
        c=conversation(s,pid,cid)
        recover_interrupted(s,cid)
        previous=s.scalar(select(ResearchMessage).where(ResearchMessage.conversation_id==cid,ResearchMessage.request_key==data.idempotency_key,ResearchMessage.role=='assistant'))
        if previous:
            if previous.request_hash!=digest:raise k.Problem('Idempotency key was used for a different request')
            return message_view(s,previous)
        project=k.get(s,Project,pid)
        context,history=context_override if context_override is not None else ResearchContextBuilder().build(s,pid,data.selected_object_id,cid,data.message)
        # Serialize one turn at a time per conversation, without holding a DB transaction over inference.
        if s.scalar(select(ResearchMessage).where(ResearchMessage.conversation_id==cid,ResearchMessage.status=='running')):raise k.Problem('A turn is already running. Refresh its state before sending another.')
        msg=ResearchMessage(id=uid(),conversation_id=cid,role='assistant',content='',mode=data.mode,status='running',request_key=data.idempotency_key,request_hash=digest,context={'object_revisions':[{key:o[key] for key in ['id','revision_id','revision_number']} for o in context['objects']],'truncated':context['truncated'],'omitted_objects':context['omitted_objects'],'literature_references':[{key:v[key] for key in ['source_id','snapshot_id','content_hash','access_level']} for v in context.get('literature',[])]})
        s.add(ResearchMessage(conversation_id=cid,role='user',content=data.message,mode=data.mode,status='completed',request_key=data.idempotency_key,request_hash=digest))
        s.add(msg);s.flush();mid=msg.id;settings=project.settings;c.updated_at=now()
    provenance={'prompt_version':PROMPT_VERSION,'generated_at':now(),'mode':data.mode,'generation_parameters':{},'estimated_cost':None}
    acquired=False
    try:
        name,model,provider=route(settings,MODE_ROLES[data.mode]);provenance.update(provider=name,model=model)
        acquired=inference_slots.acquire(blocking=False)
        if not acquired:raise ProviderError('busy','Local inference capacity is busy. Retry shortly with a new request key.')
        tokens=max(256,min(8000,int(os.getenv('VECTORHEART_MAX_OUTPUT_TOKENS','3000'))));timeout=max(5,min(40,float(os.getenv('VECTORHEART_MODEL_TIMEOUT','30'))))
        provenance.update(max_output_tokens=tokens,timeout_seconds=timeout)
        provenance.update(run_provenance or {})
        request=ModelRequest(model,SYSTEM_PROMPT+'\n'+proposal_contract()+'\nCurrent research mode: '+data.mode+'\n'+instructions,data.message,context,history,tokens,timeout,correction_attempt=bool(run_provenance))
        result=provider.generate_structured_response(request)
        if not run_provenance:result=correct_proposals(provider,request,result)
        response=ResearchIntelligenceResponse.model_validate(result.output.model_dump())
        from app.literature import normalize_research_citations
        response=normalize_research_citations(response,context)
        if not set(response.context_references).issubset({o['id'] for o in context['objects']}):raise ProviderError('invalid_references','The response cited objects outside the supplied context. No proposals were saved; retry the question.')
        if not set(response.literature_references).issubset({v['source_id'] for v in context.get('literature',[])}):raise ProviderError('invalid_references','The response cited a publication outside the retrieved literature context.')
        with k.transaction() as s:
            msg=s.get(ResearchMessage,mid);msg.content=response.answer;msg.status='completed';msg.provenance={**provenance,'generated_at':now(),'usage':result.usage,'proposal_correction':result.correction}
            rejected=list(result.rejected_proposals)
            transport_rejected={item['index'] for item in result.rejected_proposals}
            source_indices=result.proposal_indices if result.proposal_indices is not None else [i for i in range(len(response.proposals)+len(transport_rejected)) if i not in transport_rejected]
            for i,p in zip(source_indices,response.proposals):
                try:
                    payload=validated_proposal(s,pid,p,context)
                    if run_provenance:
                        from app.stage3 import normalized
                        typ={'create_question':'question','create_hypothesis':'hypothesis','create_observation':'observation'}.get(p.action_type)
                        if typ and any(o.object_type==typ and normalized(o.body)==normalized(p.content) for o in s.scalars(select(Object).where(Object.project_id==pid,Object.deleted==False))):
                            raise ValueError('This scientific statement already exists in the project; a duplicate proposal was withheld.')
                        if p.action_type=='propose_relationship' and s.scalar(select(Relationship).where(Relationship.project_id==pid,Relationship.source_object_id==p.source_object_id,Relationship.target_object_id==p.target_object_id,Relationship.relationship_type==p.relationship_type)):
                            raise ValueError('This directed relationship already exists; no duplicate proposal is needed.')
                except (ValueError,k.Problem) as exc:rejected.append({'index':i,'reason':str(exc) if isinstance(exc,ValueError) else exc.message});continue
                proposal_record=ResearchProposal(project_id=pid,source_message_id=mid,action_type=p.action_type,payload=payload,source_references=p.referenced_object_ids,provenance=msg.provenance)
                s.add(proposal_record);s.flush()
                k.event(s,pid,'intelligence_proposal_generated',p.referenced_object_ids,{'proposal_id':proposal_record.id,'title':p.title,'action_type':p.action_type,'message_id':mid,'provider':name,'model':model},actor='model')
            tool=None
            if response.tool_request:
                from app.literature import validate_tool
                tool=validate_tool(s,pid,response.tool_request.model_dump()).model_dump()
            msg.response_details={'tool_request':tool,'uncertainties':response.uncertainties,'limitations':response.limitations,'context_references':response.context_references,'literature_references':response.literature_references,'rejected_proposals':rejected}
            s.flush();return message_view(s,msg)
    except Exception as exc:
        error=exc if isinstance(exc,ProviderError) else safe_error(exc)
        with k.transaction() as s:
            msg=s.get(ResearchMessage,mid);msg.status='failed';msg.content=error.message;msg.provenance=provenance;msg.response_details={'error_code':error.code};s.flush();return message_view(s,msg)
    finally:
        if acquired:inference_slots.release()

@router.post('/v1/projects/{pid}/intelligence/proposals/{proposal_id}/accept')
def accept(pid:str,proposal_id:str):
    k=services()
    with Session() as lookup:
        candidate=k.get(lookup,ResearchProposal,proposal_id,pid)
        literature=candidate.action_type=='propose_literature_relationship'
    if literature:
        from app.literature import accept_proposal
        return accept_proposal(pid,proposal_id)
    with k.transaction() as s:
        p=k.get(s,ResearchProposal,proposal_id,pid)
        if p.status=='accepted':return proposal_view(p)
        if p.status!='pending':raise k.Problem('Rejected proposals cannot be accepted')
        payload=p.payload
        raw=ScientificProposal.model_validate({key:value for key,value in payload.items() if key in ScientificProposal.model_fields})
        source=s.get(ResearchMessage,p.source_message_id)
        context={'objects':source.context['object_revisions'],'literature':source.context.get('literature_references',[])}
        referenced=set(raw.referenced_object_ids+raw.evidence_ids+([raw.target_object_id] if raw.target_object_id else [])+([raw.source_object_id] if raw.source_object_id else []))
        for ref in context['objects']:
            if ref['id'] in referenced and k.get(s,Object,ref['id'],pid).current_revision!=ref['revision_number']:
                raise k.Problem('Referenced research changed since generation. Request a fresh proposal against its current revision.')
        if p.action_type=='propose_revision':
            target=k.get(s,Object,raw.target_object_id,pid)
            if target.current_revision!=payload['base_revision']:raise k.Problem('Hypothesis changed since this proposal. Request a new proposal against its current revision.')
        try:validated_proposal(s,pid,raw,context)
        except ValueError as exc:raise k.Problem(str(exc),422)
        provenance={**p.provenance,'source_message_id':p.source_message_id,'proposal_id':p.id,'source_references':p.source_references,'literature_references':[v for v in source.context.get('literature_references',[]) if v['source_id'] in raw.literature_source_ids],'accepted_by':'human','accepted_at':now()}
        construction_source=next((k.get(s,Object,oid,pid) for oid in raw.referenced_object_ids if k.get(s,Object,oid,pid).object_type in ['note','question']),None) if p.action_type=='create_hypothesis' else None
        if p.action_type=='propose_relationship':
            existing=s.scalar(select(Relationship).where(Relationship.project_id==pid,Relationship.source_object_id==raw.source_object_id,Relationship.target_object_id==raw.target_object_id,Relationship.relationship_type==raw.relationship_type))
            edge=k.relationship(s,pid,{'sourceId':raw.source_object_id,'targetId':raw.target_object_id,'type':raw.relationship_type})
            if existing is None:edge.details={'model_provenance':provenance,'rationale':raw.rationale,'limitations':raw.limitations,'verification_status':'unverified'}
            p.result_ids={'relationship_id':edge.id}
        elif construction_source:
            op=k.propose(s,pid,k.Proposal(action_type='construct.hypothesis_from_note',target_object_ids=[construction_source.id],proposal_payload={'statement':raw.content,'assumptions':raw.assumptions,'predicted_outcomes':raw.predictions,'limitations':raw.limitations}))
            op.proposed_by='model';op.status='approved';op.approval_record={'actor':'human','timestamp':now(),'proposal_id':p.id};k.event(s,pid,'operation_approved',[construction_source.id],operation=op.id)
            op.status='running';k.event(s,pid,'operation_running',[construction_source.id],operation=op.id,actor='kernel')
            obj=k.apply_hypothesis_construction(s,pid,construction_source,op.proposal_payload,provenance,raw.title)
            for oid in raw.referenced_object_ids:
                if oid!=construction_source.id:k.relationship(s,pid,{'sourceId':obj.id,'targetId':oid,'type':'derived_from'})
            op.status='completed';op.updated_at=now();k.event(s,pid,'operation_completed',[obj.id],operation=op.id,actor='kernel')
            p.result_ids={'object_id':obj.id,'operation_id':op.id}
        elif p.action_type in ['create_question','create_hypothesis','create_observation'] or (p.action_type=='propose_experiment' and not payload['executable']):
            typ={'create_question':'question','create_hypothesis':'hypothesis','create_observation':'observation','propose_experiment':'note'}[p.action_type]
            obj=k.add_object(s,pid,typ,raw.title,raw.content,{'statement':raw.content,'assumptions':raw.assumptions,'predicted_outcomes':raw.predictions,'limitations':raw.limitations,'rationale':raw.rationale,'model_provenance':provenance,'conceptual_experiment':p.action_type=='propose_experiment','source_type':'model_suggestion','verification_status':'unverified'},actor='model')
            for oid in raw.referenced_object_ids:k.relationship(s,pid,{'sourceId':obj.id,'targetId':oid,'type':'derived_from'})
            p.result_ids={'object_id':obj.id}
        elif p.action_type=='propose_experiment':
            op=k.get(s,k.Operation,payload['prepared_operation_id'],pid) if payload.get('prepared_operation_id') else k.propose(s,pid,k.Proposal(action_type='destroy.test_hypothesis',target_object_ids=[raw.target_object_id],proposal_payload={'adapter_id':ADAPTER,'parameters':raw.adapter_parameters.model_dump(),'rationale':raw.rationale}))
            op.proposed_by='model';p.result_ids={'operation_id':op.id}
        else:
            op=k.propose(s,pid,k.Proposal(action_type='modify.propose_hypothesis_revision',target_object_ids=[raw.target_object_id],proposal_payload={'original_statement':payload['original_statement'],'proposed_statement':raw.content,'evidence_ids':raw.evidence_ids,'assumptions_changed':raw.assumptions,'scope':'\n'.join(raw.limitations),'remaining_uncertainties':raw.limitations,'rationale':raw.rationale}))
            op.proposed_by='model'
            # Human acceptance authorizes this revision; reuse approval and execution invariants.
            op.status='approved';op.approval_record={'actor':'human','timestamp':now(),'proposal_id':p.id};s.flush()
            k.event(s,pid,'operation_approved',[raw.target_object_id],operation=op.id)
            op.status='running';k.event(s,pid,'operation_running',[raw.target_object_id],operation=op.id,actor='kernel')
            k.apply_hypothesis_revision(s,target,op.proposal_payload,op.id,provenance)
            op.status='completed';op.updated_at=now();k.event(s,pid,'operation_completed',[raw.target_object_id],operation=op.id,actor='kernel')
            p.result_ids={'operation_id':op.id,'object_id':raw.target_object_id}
        if raw.literature_source_ids:
            from app.literature import link_proposal_sources
            link_proposal_sources(s,pid,p,raw.literature_source_ids,source.context.get('literature_references',[]))
        p.status='accepted';p.updated_at=now()
        k.event(s,pid,'intelligence_proposal_accepted',list(dict.fromkeys(filter(None,[p.result_ids.get('object_id'),raw.source_object_id,raw.target_object_id]))),{'proposal_id':p.id,'provenance':provenance,'result_ids':p.result_ids},p.result_ids.get('operation_id'),'human')
        result=proposal_view(p)
    return result
@router.post('/v1/projects/{pid}/intelligence/proposals/{proposal_id}/reject')
def reject(pid:str,proposal_id:str):
    k=services()
    with k.transaction() as s:
        p=k.get(s,ResearchProposal,proposal_id,pid)
        if p.status=='accepted':raise k.Problem('Accepted proposals cannot be rejected')
        if p.status=='pending':p.status='rejected';p.updated_at=now();k.event(s,pid,'intelligence_proposal_rejected',payload={'proposal_id':p.id})
        return proposal_view(p)
