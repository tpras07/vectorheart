import test from 'node:test';
import assert from 'node:assert/strict';
import { milestoneKind } from '../src/lib/evolution-shapes.ts';
const e=(type,details={},ids=[])=>({id:'1',sequence:1,type,timestamp:'2026-11-24T12:00:00Z',actor:'human',operation_id:null,details,objects:ids.map(id=>({id,title:id}))});
const objects=new Map([['h',{type:'Hypothesis'}],['j',{type:'Note',metadata:{journal_entry:true}}],['p',{type:'Evidence',metadata:{literature_source_id:'paper'}}]]);
test('explicit types map to distinct shapes',()=>{
 for(const [type,kind] of Object.entries({project_created:'origin',evolution_checkpoint:'checkpoint',evolution_branch_started:'exploration',evolution_finding_recorded:'finding',journal_milestone:'journal',experiment_completed:'experiment',evidence_recorded:'evidence',literature_source_saved:'literature',operation_failed:'unsupported',evolution_branch_focused:'navigation'}))assert.equal(milestoneKind(e(type),objects),kind);
});
test('AI proposal action determines its shape without treating the proposal as evidence',()=>{
 assert.equal(milestoneKind(e('intelligence_proposal_generated',{action_type:'create_hypothesis'}),objects),'hypothesis');
 assert.equal(milestoneKind(e('intelligence_proposal_generated',{action_type:'propose_experiment'}),objects),'experiment');
 assert.equal(milestoneKind(e('intelligence_proposal_generated',{},['h']),objects),'proposal');
 assert.equal(milestoneKind(e('intelligence_proposal_rejected',{action_type:'create_hypothesis'}),objects),'unsupported');
});
test('generic events use current object type only when known and unambiguous',()=>{
 assert.equal(milestoneKind(e('object_created',{},['h']),objects),'hypothesis');
 assert.equal(milestoneKind(e('object_created',{},['j']),objects),'journal');
 assert.equal(milestoneKind(e('object_created',{},['p']),objects),'literature');
 assert.equal(milestoneKind(e('object_created',{},['missing']),objects),'record');
 assert.equal(milestoneKind(e('object_created',{},['h','j']),objects),'record');
 assert.equal(milestoneKind(e('evolution_finding_recorded',{outcome:'unsupported'},['h']),objects),'finding');
});
