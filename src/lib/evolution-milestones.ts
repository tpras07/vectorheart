export type Milestone = {id:string; sequence:number; type:string; timestamp:string; actor:string; operation_id:string|null; objects:{id:string;title:string}[]; details:Record<string,string|number|null>};
export type DisplayMilestone = Milestone & {history:Milestone[]};
export const checkpoint = "evolution_checkpoint", start = "evolution_branch_started", close = "evolution_branch_closed", focus = "evolution_branch_focused";
export const finding = "evolution_finding_recorded";
const boundary = new Set([checkpoint,start,close,focus,finding]);
const journalTypes = new Set(["object_created","journal_saved","object_revised"]);

/** Collapse journal bookkeeping within each checkpoint/branch interval, never across a boundary. */
export function displayMilestones(events:Milestone[], journalIds:ReadonlySet<string>, raw=false):DisplayMilestone[]{
  const knownJournals = new Set(journalIds);
  for(const event of events) if(event.type==="journal_saved") for(const object of event.objects) knownJournals.add(object.id);
  const result:DisplayMilestone[]=[];
  const groups=new Map<string,DisplayMilestone>();
  for(const event of events){
    if(boundary.has(event.type)) groups.clear();
    const object=event.objects[0];
    if(!raw && event.objects.length===1 && knownJournals.has(object.id) && journalTypes.has(event.type)){
      const existing=groups.get(object.id);
      if(existing){existing.history.push(event);continue;}
      const milestone:DisplayMilestone={...event,type:"journal_milestone",history:[event]};
      groups.set(object.id,milestone);result.push(milestone);
    }else result.push({...event,history:[event]});
  }
  return result;
}

/** Attribute events to the selected tracking lane, not the most recently created lane. */
export function layoutMilestones(milestones:DisplayMilestone[]){
  let lane=0;
  const lanes=[{id:"main",title:"Main research"}];
  const nodes:{event:DisplayMilestone;lane:number;x:number}[]=[];
  const edges:{from:string;to:string}[]=[];
  const tails=new Map<number,string>();
  const laneIndex=new Map<string,number>([["main",0]]);
  for(const event of milestones){
    let eventLane=lane;
    if(event.type===start){
      lane=lanes.length;eventLane=lane;laneIndex.set(event.id,lane);
      lanes.push({id:event.id,title:String(event.details.title)});
      edges.push({from:String(event.details.checkpoint_id),to:event.id});
    }else{
      if(event.type===focus){lane=laneIndex.get(String(event.details.branch_id??"main"))??0;eventLane=lane;}
      if(event.type===close || event.type===finding)eventLane=laneIndex.get(String(event.details.branch_id))??lane;
      if(tails.has(eventLane))edges.push({from:tails.get(eventLane)!,to:event.id});
    }
    nodes.push({event,lane:eventLane,x:180+nodes.length*146});tails.set(eventLane,event.id);
    if(event.type===close && lane===eventLane)lane=0;
  }
  return {lanes,nodes,edges,byId:new Map(nodes.map(n=>[n.event.id,n]))};
}
