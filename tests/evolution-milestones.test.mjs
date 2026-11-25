import test from 'node:test';
import assert from 'node:assert/strict';
import { displayMilestones, checkpoint, start, close, focus, layoutMilestones } from '../src/lib/evolution-milestones.ts';
const event=(i,type,id)=>({id:String(i),sequence:i,type,timestamp:`2026-11-24T12:${String(i).padStart(2,'0')}:00Z`,actor:'human',operation_id:null,objects:id?[{id,title:id}]:[],details:{}});
test('journal creation and autosaves group by ID; other objects remain milestones',()=>{
 const events=[event(1,'object_created','j1'),event(2,'journal_saved','j1'),event(3,'object_created','j2'),event(4,'journal_saved','j1'),event(5,'journal_saved','j2'),event(6,'object_created','hypothesis')];
 const nodes=displayMilestones(events,new Set());
 assert.deepEqual(nodes.map(n=>n.id),['1','3','6']);
 assert.deepEqual(nodes.map(n=>n.history.length),[3,2,1]);
 assert.equal(nodes[2].type,'object_created');
 assert.equal(nodes.flatMap(n=>n.history).length,events.length);
 assert.equal(displayMilestones(events,new Set(),true).length,events.length);
});
test('checkpoint and exploration boundaries prevent cross-branch grouping',()=>{
 const events=[event(1,'object_created','j'),event(2,'journal_saved','j'),event(3,checkpoint),event(4,start),event(5,'journal_saved','j'),event(6,'journal_saved','j'),event(7,close),event(8,'journal_saved','j')];
 const nodes=displayMilestones(events,new Set(['j']));
 assert.deepEqual(nodes.map(n=>n.id),['1','3','4','5','7','8']);
 assert.deepEqual(nodes.map(n=>n.history.length),[2,1,1,2,1,1]);
});
test('empty known journals group correctly without saves and inputs remain unchanged',()=>{
 const events=[event(1,'object_created','empty'),event(2,'project_created')];
 const nodes=displayMilestones(events,new Set(['empty']));
 assert.equal(nodes[0].type,'journal_milestone');
 assert.equal(events[0].type,'object_created');
 assert.equal(nodes[1].type,'project_created');
});

test('switching and closing a nonfocused lane preserve timeline attribution',()=>{
 const marker=(i,type,details)=>({...event(i,type),details});
 const events=[event(1,checkpoint),marker(2,start,{checkpoint_id:'1',title:'A'}),event(3,'journal_saved','j'),marker(4,start,{checkpoint_id:'1',title:'B'}),event(5,'journal_saved','j'),marker(6,focus,{branch_id:'2'}),event(7,'journal_saved','j'),marker(8,close,{branch_id:'4'}),event(9,'journal_saved','j'),marker(10,focus,{branch_id:null}),event(11,'journal_saved','j')];
 const graph=layoutMilestones(displayMilestones(events,new Set()));
 assert.deepEqual(graph.nodes.map(n=>n.lane),[0,1,1,2,2,1,1,2,1,0,0]);
 assert.ok(graph.edges.some(e=>e.from==='5'&&e.to==='8'));
 assert.ok(graph.edges.some(e=>e.from==='7'&&e.to==='9'));
 assert.equal(graph.nodes.flatMap(n=>n.event.history).length,events.length);
});

test('a finding on an unfocused branch stays on that branch without redirecting later activity',()=>{
 const marker=(i,type,details)=>({...event(i,type),details});
 const events=[event(1,checkpoint),marker(2,start,{checkpoint_id:'1',title:'A'}),marker(3,start,{checkpoint_id:'1',title:'B'}),marker(4,'evolution_finding_recorded',{branch_id:'2'}),event(5,'journal_saved','j')];
 const graph=layoutMilestones(displayMilestones(events,new Set()));
 assert.deepEqual(graph.nodes.map(n=>n.lane),[0,1,2,1,2]);
 assert.ok(graph.edges.some(e=>e.from==='2'&&e.to==='4'));
 assert.ok(graph.edges.some(e=>e.from==='3'&&e.to==='5'));
});
