"use client";

import { ResearchLoading } from "./research-loading";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, X } from "lucide-react";
import { kernel } from "@/lib/kernel-repository";
import { type Project, type ResearchObject } from "@/lib/projects";
import { useWorkspace } from "./workspace-provider";
import { ConfiguredModel } from "./configured-model";
import { type GraphOverlay, type ResearchRun, type ScientificProposal } from "./graph-intelligence";

export type PaperSource = { source_id: string; snapshot_id: string; object_id?: string | null; title: string; authors: string[]; year: number | null; venue: string; identifiers: Record<string,string>; publisher_url: string | null; open_access_url: string | null; provider_url: string; abstract: string; publication_type: string; provider: string; retrieved_at: string; retraction_status: string; access_level: "metadata" | "abstract"; content_hash: string; associations?: LiteratureProposal[]; versions?:{snapshot_id:string;provider:string;retrieved_at:string}[] };
type Association = { source_id:string; snapshot_id:string; target_object_id:string|null; classification:string; claim:string; rationale:string; access_level:string; passage_start:number; passage_end:number; limitations:string[]; method_notes:string[]; missing_information:string[] };
type LiteratureProposal = ScientificProposal & { payload: ScientificProposal["payload"] & { literature:Association } };
type LiteratureRun = ResearchRun & {output:ResearchRun["output"] & { retrieval?:{unique_papers:number;network_requests:number;cache_hits:number;warnings:string[]}; analyzed_papers?:number; planning_warning?:string; disagreements?:string[]; withheld?:string[]; queries?:{query:string;strategy:string;rationale:string}[] } };

export function literatureOverlay(sources:PaperSource[], proposals:LiteratureProposal[], project:Project):GraphOverlay {
  const nodes:ResearchObject[]=[],edges:GraphOverlay["edges"]=[];
  for(const source of sources.slice(0,8)){
    const object=project.objects.find(o=>o.metadata?.literature_source_id===source.source_id && o.metadata?.origin==="literature_source");
    const id=object?.id ?? `literature-${source.source_id}`;
    nodes.push(object ?? {id,projectId:project.id,type:"Concept",title:source.title.slice(0,120),body:`${source.authors.slice(0,2).join(", ")} · ${source.year ?? "Year unknown"} · ${source.venue}`,createdAt:source.retrieved_at,updatedAt:source.retrieved_at,metadata:{literature_source_id:source.source_id,origin:"literature_candidate",provisional:true,access_level:source.access_level}});
    for(const p of proposals.filter(p=>p.status==="pending" && p.payload.literature.source_id===source.source_id)){
      const target=p.payload.target_object_id;if(!target)continue;
      edges.push({id:`lit-proposal-${p.id}`,sourceId:id,targetId:target,type:p.payload.literature.classification.replaceAll("_"," "),novel:false});
      const existing=project.objects.find(o=>o.id===target);if(existing && !nodes.some(o=>o.id===target))nodes.push(existing);
    }
  }
  return {nodes,edges};
}

export function LiteratureIntelligence({project,onOverlay,inspection,closeInspection,selection,relationshipId}:{project:Project;onOverlay:(overlay:GraphOverlay)=>void;inspection:string|null;closeInspection:()=>void;selection:string[];relationshipId:string|null}){
  const {sync}=useWorkspace();
  const [runs,setRuns]=useState<LiteratureRun[]>([]),[selected,setSelected]=useState("");
  const [sources,setSources]=useState<PaperSource[]>([]),[proposals,setProposals]=useState<LiteratureProposal[]>([]);
  const [target,setTarget]=useState(""),[query,setQuery]=useState(""),[useModel,setUseModel]=useState(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[identifier,setIdentifier]=useState("");
  const [externalSnapshot,setExternalSnapshot]=useState<string|null>(null);
  const [externalSource,setExternalSource]=useState<string|null>(null),[inspected,setInspected]=useState<PaperSource|null>(null),[rationale,setRationale]=useState("");
  const selectedRef=useRef("");const path=`projects/${project.id}`;
  useEffect(()=>{void Promise.resolve().then(()=>{setExternalSource(null);setExternalSnapshot(null);});},[inspection]);
  const run=runs.find(r=>r.id===selected);
  const load=useCallback(async()=>{
    const list=(await kernel<LiteratureRun[]>(`${path}/research-runs`)).filter(r=>r.kind==="literature");setRuns(list);
    const id=selectedRef.current || list[0]?.id;
    if(id){selectedRef.current=id;setSelected(id);setProposals(await kernel<LiteratureProposal[]>(`${path}/research-runs/${id}/proposals`));}
    setSources(await kernel<PaperSource[]>(`${path}/literature/sources${id?`?run_id=${id}`:""}`));
  },[path]);
  useEffect(()=>{let active=true;const update=()=>{if(active)void load().catch(e=>{if(active)setError(String(e));});};update();const timer=setInterval(update,2500);return()=>{active=false;clearInterval(timer);};},[load]);
  useEffect(()=>onOverlay(literatureOverlay(sources,proposals,project)),[sources,proposals,project,onOverlay]);
  const start=useCallback(async(action:"ground"|"challenge"|"explore",ids?:string[])=>{
    setBusy(true);setError("");
    try{await sync();const result=await kernel<LiteratureRun>(`${path}/literature/runs`,"POST",{action,object_ids:ids ?? (target?[target]:selection),relationship_id:!target?relationshipId:null,query,use_model:useModel,idempotency_key:crypto.randomUUID()});selectedRef.current=result.id;setSelected(result.id);await load();}
    catch(e){setError(String(e));}finally{setBusy(false);}
  },[load,path,query,relationshipId,selection,sync,target,useModel]);
  useEffect(()=>{
    const action=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail.projectId===project.id){setTarget(detail.objectId);void start(detail.action,[detail.objectId]);}};
    const inspect=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail.projectId===project.id){setExternalSource(detail.sourceId);setExternalSnapshot(null);}};
    window.addEventListener("vectorheart-literature-action",action);window.addEventListener("vectorheart-literature-inspect",inspect);
    return()=>{window.removeEventListener("vectorheart-literature-action",action);window.removeEventListener("vectorheart-literature-inspect",inspect);};
  },[project.id,start]);
  const proposal=proposals.find(p=>inspection===`lit-proposal-${p.id}`);
  const sourceId=externalSource ?? (proposal?.payload.literature.source_id || (inspection?.startsWith("literature-")?inspection.slice(11):inspection?.startsWith("source-")?inspection.slice(7):null));
  const snapshotId=externalSnapshot ?? proposal?.payload.literature.snapshot_id;
  useEffect(()=>{let active=true;if(sourceId)void kernel<PaperSource>(`${path}/literature/sources/${sourceId}${snapshotId?`?snapshot_id=${snapshotId}`:""}`).then(value=>{if(active)setInspected(value);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[sourceId,snapshotId,path,proposals]);
  const previousState=useRef("");
  useEffect(()=>{const value=run?`${run.id}-${run.status}`:"";if(value && value!==previousState.current){previousState.current=value;void sync().catch(e=>setError(String(e)));}},[run,sync]);
  async function action(route:string,body:unknown={}){
    setBusy(true);setError("");try{await sync();await kernel(`${path}/${route}`,"POST",body);await sync();await load();window.dispatchEvent(new Event("vectorheart-research-refresh"));}catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function resolve(){setBusy(true);setError("");try{await sync();const source=await kernel<PaperSource>(`${path}/literature/resolve`,"POST",{identifier});selectedRef.current="";await load();setExternalSource(source.source_id);}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function analyzeStored(){if(!run)return;setBusy(true);setError("");try{await sync();const next=await kernel<LiteratureRun>(`${path}/literature/runs/${run.id}/analyze`,"POST",{});selectedRef.current=next.id;setSelected(next.id);await load();}catch(e){setError(String(e));}finally{setBusy(false);}}
  function close(){setExternalSource(null);setExternalSnapshot(null);closeInspection();}
  const visibleAssociations=proposal?[proposal]:inspected?.associations ?? [];
  return <section className="literature-intelligence" aria-label="Literature Intelligence">
    <ResearchLoading active={busy || run?.status === "queued" || run?.status === "running"} label="Preparing literature results…" detail="Waiting for the scholarly research operation to finish." />
    <div className="literature-actions"><BookOpen size={16}/><button className="text-button" disabled={busy} onClick={()=>void start("ground")}>Ground in Literature</button><button className="text-button" disabled={busy} onClick={()=>void start("challenge")}>Challenge with Literature</button><button className="text-button" disabled={busy} onClick={()=>void start("explore",[])}>Explore Literature</button></div>
    {useModel && <ConfiguredModel project={project} role="Literature Analysis" />}
    <details className="literature-search-options"><summary>Search scope & identifiers</summary>
      <label>Research focus<select aria-label="Literature research focus" value={target} onChange={e=>setTarget(e.target.value)}><option value="">{selection.length?`${selection.length} selected graph objects`:relationshipId?"Selected relationship":"Project-wide context"}</option>{project.objects.filter(o=>!o.metadata?.literature_source_id).map(o=><option key={o.id} value={o.id}>{o.type}: {o.title||"Untitled"}</option>)}</select></label>
      <label>Optional search terms<input aria-label="Literature search terms" value={query} maxLength={500} onChange={e=>setQuery(e.target.value)} placeholder="Scientific concepts, competing mechanisms, methods…"/></label>
      <label className="literature-checkbox"><input type="checkbox" checked={useModel} onChange={e=>setUseModel(e.target.checked)}/>Use configured Literature Analysis model for planning and interpretation</label><p className="field-help">Without a model, retrieve and inspect real sources; no support or contradiction is inferred.</p>
      <div className="literature-resolve"><input aria-label="Resolve scholarly identifier" value={identifier} maxLength={250} onChange={e=>setIdentifier(e.target.value)} placeholder="DOI, PMID, PMCID or OpenAlex work ID"/><button className="text-button" disabled={busy||!identifier.trim()} onClick={()=>void resolve()}>Resolve identifier</button></div>
    </details>
    {error&&<p role="alert">{error}</p>}
    {runs.length>0&&<div className="graph-run-state"><select aria-label="Literature investigation history" value={selected} onChange={e=>{selectedRef.current=e.target.value;setSelected(e.target.value);void load();}}>{runs.map(r=><option key={r.id} value={r.id}>{r.objective.slice(0,60)} · {r.status}</option>)}</select><span role="status">{run?.status} · {sources.length} candidate papers · {run?.output.analyzed_papers ?? 0} analyzed · {proposals.length} proposed interpretations</span>{run?.status==="failed"&&<button className="text-button" disabled={busy} onClick={()=>void action(`research-runs/${run.id}/resume`)}>Retry literature analysis</button>}</div>}
    {run?.error&&<p role="alert">{run.error} Retrieved publications remain available below.</p>}
    {run&&sources.length>0&&["completed","failed"].includes(run.status)&&<button className="text-button" disabled={busy} onClick={()=>void analyzeStored()}>Analyze available sources</button>}
    {run&&["queued","running"].includes(run.status)&&<button className="text-button" disabled={busy} onClick={()=>void action(`research-runs/${run.id}/cancel`)}>Stop literature investigation</button>}
    {run&&<details className="literature-summary"><summary>Literature summary, queries & limitations</summary><p className="preserve-writing">{run.output.summary}</p>{run.output.queries?.map((q,i)=><p key={i}><strong>{q.strategy}</strong> · {q.query}<br/>{q.rationale}</p>)}{[...(run.output.limitations??[]),...(run.output.disagreements??[]),...(run.output.withheld??[]),...(run.output.retrieval?.warnings??[]),...(run.output.planning_warning?[run.output.planning_warning]:[])].map((v,i)=><p key={i}>{v}</p>)}</details>}
    {sources.length>0&&<details className="literature-candidates"><summary>Inspect retrieved publications ({sources.length})</summary>{sources.map(source=><div key={source.source_id}><button className="text-button" onClick={()=>{setExternalSource(source.source_id);setExternalSnapshot(null);}}>{source.title}</button><small>{source.year??"Year unknown"} · {source.access_level} available · {source.provider}</small></div>)}</details>}
    {sourceId&&inspected&&inspected.source_id===sourceId&&<aside className="graph-inspector literature-inspector" aria-label="Scholarly source inspection"><button className="icon-button inspector-close" aria-label="Close literature inspection" onClick={close}><X size={18}/></button><p className="eyebrow">Verified bibliographic record · {inspected.access_level} access</p><h3>{inspected.title}</h3><p>{inspected.authors.join(", ")}</p><p>{inspected.year??"Year unknown"} · {inspected.venue} · {inspected.publication_type}</p><p>Retraction/correction status: {inspected.retraction_status}. “Unknown” or “not flagged” is not a guarantee.</p><div className="proposal-sources">{inspected.publisher_url&&<a href={inspected.publisher_url} target="_blank" rel="noreferrer">Publication / DOI</a>}<a href={inspected.provider_url} target="_blank" rel="noreferrer">Verify provider record</a>{inspected.open_access_url&&<a href={inspected.open_access_url} target="_blank" rel="noreferrer">Open-access link</a>}</div><p className="field-help">{Object.entries(inspected.identifiers).map(([key,value])=>`${key}: ${value}`).join(" · ")}</p><label>Retrieved source version<select aria-label="Retrieved source version" value={inspected.snapshot_id} onChange={e=>setExternalSnapshot(e.target.value)}>{inspected.versions?.map(v=><option key={v.snapshot_id} value={v.snapshot_id}>{v.provider} ? {v.retrieved_at}</option>)}</select></label><details><summary>Available abstract</summary><p className="preserve-writing">{inspected.abstract||"No abstract was returned. Metadata/title alone cannot establish findings."}</p></details><p className="field-help">Published reports are not independently reproduced evidence or individual medical advice. No full text was fetched.</p><button className="text-button" disabled={busy} onClick={()=>void action(`literature/sources/${sourceId}/save`)}>Save paper reference</button>
      {visibleAssociations.map(p=><article key={p.id} className="literature-association"><button className="text-button" onClick={()=>setExternalSnapshot(p.payload.literature.snapshot_id)}>View analyzed snapshot</button><h4>{p.payload.literature.classification.replaceAll("_"," ")} · {p.status}</h4><p>{p.payload.content}</p><p>{p.payload.rationale}</p><p className="field-help">{project.objects.find(o=>o.id===p.payload.target_object_id)?.title||"Project context"} · {p.payload.literature.access_level}, characters {p.payload.literature.passage_start}–{p.payload.literature.passage_end} · interpreted by {String(p.provenance.provider)} / {String(p.provenance.model)}</p>{[...p.payload.literature.limitations,...p.payload.literature.method_notes,...p.payload.literature.missing_information].map((v,i)=><p className="field-help" key={i}>{v}</p>)}{p.status==="pending"&&<><label>Optional review rationale<textarea aria-label="Literature review rationale" value={rationale} maxLength={4000} onChange={e=>setRationale(e.target.value)}/></label><div className="dialog-actions"><button className="text-button" disabled={busy} onClick={()=>void action(`research-runs/${String(p.provenance.research_run_id)}/proposals/${p.id}/accept`,{rationale})}>Accept literature relationship</button><button className="text-button" disabled={busy} onClick={()=>void action(`research-runs/${String(p.provenance.research_run_id)}/proposals/${p.id}/reject`,{rationale})}>Reject literature interpretation</button></div></>}</article>)}
      <details><summary>Retrieval provenance</summary><p>Retrieved {inspected.retrieved_at}</p><p>Snapshot {inspected.snapshot_id}</p><p>Content hash {inspected.content_hash}</p></details>
    </aside>}
  </section>;
}
