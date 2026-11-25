import { checkpoint, start, close, focus, finding, type Milestone } from './evolution-milestones';

export const milestoneKinds = ['origin','checkpoint','exploration','hypothesis','experiment','finding','journal','observation','evidence','literature','proposal','question','relationship','navigation','unsupported','record'] as const;
export type MilestoneKind = typeof milestoneKinds[number];
export const milestoneNames: Record<MilestoneKind,string> = {
  origin:'Project start', checkpoint:'Checkpoint', exploration:'Exploration', hypothesis:'Hypothesis', experiment:'Experiment', finding:'Finding', journal:'Journal', observation:'Observation', evidence:'Evidence', literature:'Literature', proposal:'AI proposal', question:'Question', relationship:'Relationship', navigation:'Lane switch', unsupported:'Rejected / failed / unsupported', record:'Other activity',
};
const objectKinds: Record<string,MilestoneKind> = { Hypothesis:'hypothesis', Experiment:'experiment', Observation:'observation', Evidence:'evidence', Question:'question', Note:'record', Prediction:'hypothesis', Concept:'record' };
const actions: Record<string,MilestoneKind> = { create_hypothesis:'hypothesis', propose_experiment:'experiment', create_observation:'observation', create_question:'question', propose_relationship:'relationship' };
export type ObjectKind = { type:string; metadata?:Record<string,unknown> };
/** Classify explicit event semantics first. Use the current linked object type only for single-object lifecycle records. */
export function milestoneKind(event:Milestone, objects:ReadonlyMap<string,ObjectKind>):MilestoneKind {
  const t=event.type;
  if(t===checkpoint)return 'checkpoint';
  if(t===start)return 'exploration';
  if(t===finding)return 'finding';
  if(t===focus)return 'navigation';
  if(t===close)return event.details.outcome==='unsupported'?'unsupported':'exploration';
  if(t==='project_created'||t==='legacy_import')return 'origin';
  if(t==='journal_milestone'||t==='journal_saved')return 'journal';
  if(/failed|rejected|cancelled/.test(t))return 'unsupported';
  if(t.startsWith('literature_'))return 'literature';
  if(t.includes('evidence'))return 'evidence';
  if(t.startsWith('experiment_'))return 'experiment';
  if(t.startsWith('relationship_'))return 'relationship';
  if(t.startsWith('intelligence_proposal_'))return actions[String(event.details.action_type)]??'proposal';
  if(['object_created','object_revised','revision_accepted','object_removed'].includes(t)&&event.objects.length===1){
    const o=objects.get(event.objects[0].id);
    if(o?.metadata?.journal_entry)return 'journal';
    if(o?.metadata?.literature_source_id)return 'literature';
    if(o)return objectKinds[o.type]??'record';
  }
  return 'record';
}
