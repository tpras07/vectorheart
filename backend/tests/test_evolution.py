from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
def post(path, payload):
    r=client.post('/v1/'+path,json=payload);assert r.status_code==200,r.text;return r.json()
def get(path):
    r=client.get('/v1/'+path);assert r.status_code==200,r.text;return r.json()

def test_checkpoint_and_activity_lanes():
    pid=post('projects',{'title':'Evolution'})['id'];base=f'projects/{pid}';ev=base+'/evolution'
    obj=post(base+'/objects',{'projectId':pid,'type':'Note','title':'Original','body':'Initial record'})
    cp=post(ev+'/checkpoints',{'title':'Reviewed observations','note':'Limited to synthetic setting'})
    first=post(ev+'/branches',{'checkpoint_id':cp['id'],'title':'Alternative A'})
    r=client.patch('/v1/'+base+'/objects/'+obj['id'],json={'body':'Changed later'});assert r.status_code==200
    post(ev+'/branches/'+first['id']+'/close',{'outcome':'inconclusive','note':'No clear evidence'})
    second=post(ev+'/branches',{'checkpoint_id':cp['id'],'title':'Alternative B'})
    trail=get(ev);assert trail['active_branch']==second['id'];assert any(e['type']=='object_revised' for e in trail['events'])
    assert get(ev+'/checkpoints/'+cp['id'])['objects'][0]['body']=='Initial record'
    assert get(base+'/objects/'+obj['id'])['body']=='Changed later' # never claim rollback
    assert 'snapshot' not in next(e for e in trail['events'] if e['id']==cp['id'])['details']
    foreign=post('projects',{'title':'Foreign'})['id']
    assert client.get(f'/v1/projects/{foreign}/evolution/checkpoints/{cp["id"]}').status_code==404
    assert client.post(f'/v1/projects/{foreign}/evolution/branches',json={'checkpoint_id':cp['id'],'title':'Invalid'}).status_code==404
    assert [e['sequence'] for e in trail['events']]==sorted(e['sequence'] for e in trail['events'])

# Reuse the repository's deterministic AI provider fixture, not a live paid model.
from test_intelligence import fake, project, turn, proposal, accept

def test_ai_proposals_appear_automatically(fake):
    pid,cid=project();ev=f'projects/{pid}/evolution'
    cp=post(ev+'/checkpoints',{'title':'Baseline'})
    lane=post(ev+'/branches',{'checkpoint_id':cp['id'],'title':'AI exploration'})
    fake.output['proposals']=[proposal()]
    response=turn(pid,cid)
    proposal_id=response['proposals'][0]['id']
    generated=[e for e in get(ev)['events'] if e['type']=='intelligence_proposal_generated']
    assert len(generated)==1 and generated[0]['details']['proposal_id']==proposal_id and generated[0]['actor']=='model'
    assert generated[0]['sequence']>lane['sequence']
    accept(pid,response['proposals'][0]);turn(pid,cid)
    assert len([e for e in get(ev)['events'] if e['type']=='intelligence_proposal_generated'])==1
    assert any(e['type']=='intelligence_proposal_accepted' and e['details']['proposal_id']==proposal_id for e in get(ev)['events'])

def test_experiment_progress_appears_automatically():
    pid=post('projects',{'title':'Simulation'})['id'];base=f'projects/{pid}'
    post(base+'/demo',{})
    op=get(base+'/operations')[0]['id']
    post(f'{base}/operations/{op}/approve',{})
    post(f'{base}/operations/{op}/execute',{})
    types={e['type'] for e in get(base+'/evolution')['events']}
    assert {'operation_approved','operation_running','experiment_completed','evidence_recorded','operation_completed'} <= types


def test_multiple_open_lanes_and_switching():
    pid=post('projects',{'title':'Parallel tracks'})['id'];base=f'projects/{pid}';ev=base+'/evolution'
    cp=post(ev+'/checkpoints',{'title':'Baseline'})
    a=post(ev+'/branches',{'checkpoint_id':cp['id'],'title':'A'})
    b=post(ev+'/branches',{'checkpoint_id':cp['id'],'title':'B'})
    assert [v['id'] for v in get(ev)['open_branches']]==[a['id'],b['id']]
    assert get(ev)['active_branch']==b['id']
    switched=post(ev+'/focus',{'branch_id':a['id']})
    obj=post(base+'/objects',{'projectId':pid,'type':'Note','title':'A activity','body':'Evidence'})
    trail=get(ev)
    assert trail['active_branch']==a['id']
    assert any(e['sequence']>switched['sequence'] and any(o['id']==obj['id'] for o in e['objects']) for e in trail['events'])
    post(ev+'/branches/'+b['id']+'/close',{'outcome':'paused'})
    assert get(ev)['active_branch']==a['id']
    assert [v['id'] for v in get(ev)['open_branches']]==[a['id']]
    assert client.post('/v1/'+ev+'/focus',json={'branch_id':b['id']}).status_code==409
    post(ev+'/focus',{'branch_id':None})
    assert get(ev)['active_branch'] is None
    assert len(get(ev)['open_branches'])==1
    post(ev+'/focus',{'branch_id':a['id']})
    post(ev+'/branches/'+a['id']+'/close',{'outcome':'inconclusive'})
    assert get(ev)['active_branch'] is None and get(ev)['open_branches']==[]
    assert get(base+'/objects/'+obj['id'])['body']=='Evidence'
    assert get(ev+'/checkpoints/'+cp['id'])['objects']==[]


def test_finding_targets_open_lane_without_switching_focus():
    pid=post('projects',{'title':'Findings'})['id'];base=f'projects/{pid}';ev=base+'/evolution'
    cp=post(ev+'/checkpoints',{'title':'Baseline'})
    a=post(ev+'/branches',{'checkpoint_id':cp['id'],'title':'A'})
    b=post(ev+'/branches',{'checkpoint_id':cp['id'],'title':'B'})
    obj=post(base+'/objects',{'projectId':pid,'type':'Note','title':'Linked observation','body':'Record'})
    finding=post(ev+'/branches/'+a['id']+'/findings',{'title':'An observation','note':'Not conclusive','outcome':'inconclusive','object_id':obj['id']})
    assert finding['actor']=='human' and finding['details']['branch_id']==a['id']
    assert finding['objects'][0]['id']==obj['id'] and finding['details']['revision']==1
    assert get(ev+'/focus')['active_branch']==b['id']
    assert next(e for e in get(ev)['events'] if e['id']==finding['id'])==finding
    assert client.post('/v1/'+ev+'/branches/'+a['id']+'/findings',json={'title':' ','note':'x'}).status_code==422
    foreign=post('projects',{'title':'Other'})['id']
    foreign_obj=post('projects/'+foreign+'/objects',{'projectId':foreign,'type':'Note','title':'Other','body':'x'})
    assert client.post('/v1/'+ev+'/branches/'+a['id']+'/findings',json={'title':'x','note':'x','object_id':foreign_obj['id']}).status_code==404
    post(ev+'/branches/'+a['id']+'/close',{'outcome':'paused'})
    assert client.post('/v1/'+ev+'/branches/'+a['id']+'/findings',json={'title':'x','note':'x'}).status_code==409
