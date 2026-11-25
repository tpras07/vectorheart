"use client";

import { EvolutionMarker } from "./evolution-marker";
import { milestoneKind, milestoneKinds, milestoneNames } from "@/lib/evolution-shapes";
import { ResearchLoading } from "./research-loading";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import "./evolution-motion.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kernel } from "@/lib/kernel-repository";
import type { Project } from "@/lib/projects";
import { useWorkspace } from "./workspace-provider";

import { checkpoint, start, close, focus, finding, displayMilestones, layoutMilestones, type Milestone } from "@/lib/evolution-milestones";
type Evolution = {active_branch:string|null;open_branches:{id:string;title:string;checkpoint_id:string}[];events:Milestone[]};
type Snapshot = Pick<Project,"title"|"description"|"question"|"objects"|"relationships"|"placements">;
const words = (s:string) => s.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase());
const label = (e:Milestone) => {
  const title=e.objects[0]?.title;
  if(e.type===focus) return e.details.branch_id ? "Switched exploration" : "Returned to main";
  if(e.type==="journal_milestone") return title || "Untitled journal";
  if(e.type==="object_created" && title) return title;
  return String(e.details.title || (e.type===close ? `Lane closed: ${words(String(e.details.outcome))}` : words(e.type)));
};
const color = (e:Milestone) => e.type===finding && e.details.outcome==="unsupported" ? "#b45365" : e.type===close && e.details.outcome==="unsupported" ? "#b45365" : e.type===checkpoint || e.type===finding ? "#6d28d9" : e.type===start || e.type==="journal_milestone" ? "#8b5cf6" : /failed|rejected/.test(e.type) ? "#b45365" : /evidence|completed/.test(e.type) ? "#19806b" : e.type===close ? "#a16207" : e.actor==="model" ? "#a78bfa" : "#7c6a9d";
const date = (d:string) => new Date(d).toLocaleString();
export function ResearchEvolution({project}:{project:Project}){
  const {sync}=useWorkspace();
  const base=`projects/${project.id}/evolution`;
  const [data,setData]=useState<Evolution|null>(null), [error,setError]=useState(""), [busy,setBusy]=useState(false), [selected,setSelected]=useState<string|null>(null), [name,setName]=useState(""), [note,setNote]=useState(""), [branchName,setBranchName]=useState(""), [outcome,setOutcome]=useState("inconclusive"), [snapshot,setSnapshot]=useState<Snapshot|null>(null), [reviewNote,setReviewNote]=useState("");
  const refresh=useCallback(async()=>{setData(await kernel<Evolution>(base));setError("");},[base]);
  useEffect(()=>{let cancelled=false;const load=async()=>{try{const result=await kernel<Evolution>(base);if(!cancelled){setData(result);setError("");}}catch(e){if(!cancelled)setError(String(e));}};void load();const timer=setInterval(()=>void load(),5000);return()=>{cancelled=true;clearInterval(timer);};},[base]);
  const [raw,setRaw]=useState(false);
  const [maximized,setMaximized]=useState(false);
  const [zoom,setZoom]=useState(1);
  const [showInspector,setShowInspector]=useState(true);
  const [animationEpoch,setAnimationEpoch]=useState(0);
  const [inlineReady,setInlineReady]=useState(false);
  const inlineScrollRef=useRef<HTMLDivElement>(null);
  const fullScrollRef=useRef<HTMLDivElement>(null);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const maximizeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(maximized && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  },[maximized]);
  function closeMaximized(){
    setMaximized(false);
    requestAnimationFrame(()=>maximizeRef.current?.focus({preventScroll:true}));
  }
  const journalIds=useMemo(()=>new Set(project.objects.filter(o=>o.metadata?.journal_entry).map(o=>o.id)),[project.objects]);
  const milestones=useMemo(()=>displayMilestones(data?.events??[],journalIds,raw),[data,journalIds,raw]);
  const objectsById=useMemo(()=>new Map(project.objects.map(o=>[o.id,o])),[project.objects]);
  const graph=useMemo(()=>layoutMilestones(milestones),[milestones]);
  const hasMilestones=graph.nodes.length>0;
  // Start the entrance when the chart first comes into view, not while it is below the fold.
  useEffect(()=>{
    if(!hasMilestones || inlineReady)return;
    const element=inlineScrollRef.current;
    if(!element || typeof IntersectionObserver==="undefined"){setInlineReady(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setInlineReady(true);observer.disconnect();}
    },{threshold:0.05});
    observer.observe(element);
    return()=>observer.disconnect();
  },[hasMilestones,inlineReady,animationEpoch]);
  function replayGrowth(expanded=false){
    if(!expanded)setInlineReady(false);
    setAnimationEpoch(value=>value+1);
  }
  function openMaximized(button:HTMLButtonElement){
    maximizeRef.current=button;setZoom(1);setShowInspector(true);setMaximized(true);
  }
  const [reviewBranch,setReviewBranch]=useState<string|null>(null);
  const [findingBranch,setFindingBranch]=useState<string|null>(null);
  const [findingTitle,setFindingTitle]=useState(""),[findingNote,setFindingNote]=useState(""),[findingOutcome,setFindingOutcome]=useState("observation"),[findingObject,setFindingObject]=useState("");
  const openBranches=data?.open_branches??[];
  const findingTarget=openBranches.find(b=>b.id===findingBranch);
  const reviewTarget=openBranches.find(b=>b.id===reviewBranch);
  const current=graph.byId.get(selected??"")?.event;
  async function action(path:string,body:unknown){setBusy(true);setError("");try{await sync();const result=await kernel<Milestone>(`${base}/${path}`,"POST",body);setSelected(result.id);setSnapshot(null);await refresh();return true;}catch(e){setError(String(e));return false;}finally{setBusy(false);}}
  async function inspectSnapshot(){if(!current)return;setBusy(true);try{setSnapshot(await kernel<Snapshot>(`${base}/checkpoints/${current.id}`));}catch(e){setError(String(e));}finally{setBusy(false);}}
  const width=Math.max(700,graph.nodes.length*146+180),height=Math.max(220,graph.lanes.length*112+60);
  const nodeOrder=useMemo(()=>new Map(graph.nodes.map((node,index)=>[node.event.id,index])),[graph]);
  const growthStep=Math.min(240,2800/Math.max(1,graph.nodes.length-1));
  const edgeDuration=Math.max(35,Math.min(220,growthStep));
  function fitGraph(){
    const viewport=fullScrollRef.current;if(!viewport)return;
    setZoom(Math.min(2,Math.max(0.01,Math.min((viewport.clientWidth-12)/width,(viewport.clientHeight-12)/height))));
    viewport.scrollTo({left:0,top:0});
  }
  const legendKinds=useMemo(()=>{const present=new Set(graph.nodes.map(n=>milestoneKind(n.event,objectsById)));return milestoneKinds.filter(k=>present.has(k)||["checkpoint","exploration","hypothesis","experiment","finding","journal"].includes(k));},[graph,objectsById]);
  function renderTimeline(expanded:boolean){return <section className={`evolution-panel${expanded?" evolution-timeline-expanded":""}`}><div className="evolution-panel-title"><strong id={expanded?"evolution-max-title":undefined}>Discovery timeline</strong><span>{data?`${graph.nodes.length} ${raw?"events":"milestones"} · ${graph.lanes.length} lanes`:"Loading…"}</span></div>
      <div className="evolution-toolbar"><span>{data?`${data.events.length} underlying events preserved`:""}</span><div className="evolution-graph-controls">{expanded&&<><button type="button" aria-label="Zoom out" disabled={zoom<=0.01} onClick={()=>setZoom(v=>Math.max(0.01,v/1.25))}>−</button><button type="button" onClick={()=>setZoom(1)} aria-label="Reset zoom">{Math.round(zoom*100)}%</button><button type="button" aria-label="Zoom in" disabled={zoom>=2} onClick={()=>setZoom(v=>Math.min(2,v*1.25))}>+</button><button type="button" onClick={fitGraph}>Fit all</button><button type="button" aria-pressed={showInspector} onClick={()=>setShowInspector(v=>!v)}>{showInspector?"Hide details":"Show details"}</button></>}<button type="button" className="evolution-view-control" disabled={!hasMilestones} onClick={()=>replayGrowth(expanded)}><RotateCcw size={14} aria-hidden="true"/> Replay</button><button aria-pressed={raw} onClick={()=>{setRaw(v=>!v);setSelected(null);setSnapshot(null);}}>{raw?"Show milestones":"Show raw events"}</button>{expanded?<button type="button" className="evolution-view-control" autoFocus onClick={()=>dialogRef.current?.close()}><Minimize2 size={15} aria-hidden="true"/> Exit full view</button>:<button type="button" className="evolution-primary evolution-view-control" onClick={e=>openMaximized(e.currentTarget)}><Maximize2 size={15} aria-hidden="true"/> Full view</button>}</div></div>
      <div ref={expanded?fullScrollRef:inlineScrollRef} className="evolution-scroll" tabIndex={0} aria-label="Scrollable research timeline"><svg key={animationEpoch} className={expanded||inlineReady?"evolution-growth":"evolution-growth-waiting"} width={width*(expanded?zoom:1)} height={height*(expanded?zoom:1)} viewBox={`0 0 ${width} ${height}`} aria-label="Research evolution graph">
      {graph.lanes.map((l,i)=><g key={l.id}><text x={14} y={68+i*112} fill="#655576" fontSize={12}>{l.title.slice(0,23)}</text><line x1={150} x2={width-25} y1={64+i*112} y2={64+i*112} stroke="#eae3f5" strokeDasharray="3 6"/></g>)}
      {graph.edges.map(edge=>{const a=graph.byId.get(edge.from),b=graph.byId.get(edge.to);if(!a||!b)return null;const ay=64+a.lane*112,by=64+b.lane*112,m=(a.x+b.x)/2;const delay=Math.max(0,(nodeOrder.get(edge.to)??0)*growthStep-edgeDuration);return <path key={edge.to} className="evolution-growing-edge" pathLength={1} style={{animationDelay:`${delay}ms`,animationDuration:`${edgeDuration}ms`}} d={`M${a.x} ${ay} C${m} ${ay},${m} ${by},${b.x} ${by}`} stroke="#baa4ea" strokeWidth={2} fill="none"/>;})}
      {graph.nodes.map(({event:e,lane,x})=>{const y=64+lane*112,kind=milestoneKind(e,objectsById);return <g key={e.id} role="button" tabIndex={0} aria-label={`${milestoneNames[kind]}: ${label(e)}, ${date(e.timestamp)}`} onClick={()=>{setSelected(e.id);setSnapshot(null);}} onKeyDown={ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();setSelected(e.id);setSnapshot(null);}}} className="evolution-node evolution-growing-node" style={{animationDelay:`${(nodeOrder.get(e.id)??0)*growthStep}ms`}}><title>{`${milestoneNames[kind]}: ${label(e)}\n${date(e.timestamp)}\n${e.actor}${e.history.length>1?`\n${e.history.length} underlying events · last activity ${date(e.history[e.history.length-1].timestamp)}`:""}`}</title>{["#6d28d9","#8b5cf6","#a78bfa","#7c6a9d"].includes(color(e))&&<circle className="evolution-ripple" cx={x} cy={y} r={10} fill="none" stroke={color(e)} strokeWidth={1.5} style={{animationDelay:`${-(e.sequence%7)*0.38}s`}} aria-hidden="true"/>}{selected===e.id&&<circle cx={x} cy={y} r={17} fill="#e7dbff"/>}<circle cx={x} cy={y} r={17} fill="transparent" pointerEvents="all" aria-hidden="true"/><EvolutionMarker kind={kind} x={x} y={y} color={color(e)}/><text x={x} y={y+26} textAnchor="middle" fontSize={12} fill="#33284b">{label(e).length>19?label(e).slice(0,18)+"…":label(e)}</text><text x={x} y={y+41} textAnchor="middle" fontSize={11} fill="#786c8b">{new Date(e.timestamp).toLocaleDateString(undefined,{month:"short",day:"numeric"})}{e.type==="journal_milestone"?` · ${e.history.filter(h=>h.type==="journal_saved").length} saves`:""}</text></g>;})}
      </svg></div><div className="evolution-shape-legend" aria-label="Milestone shapes">{legendKinds.map(kind=><span key={kind}><svg viewBox="-12 -12 24 24" width={24} height={24} aria-hidden="true"><EvolutionMarker kind={kind} color={kind==="unsupported"?"#b45365":kind==="evidence"?"#19806b":"#7040c2"}/></svg>{milestoneNames[kind]}</span>)}</div><p className="evolution-caption">Select a milestone for exact time, source and linked records. Journal saves are grouped within checkpoint and exploration intervals. Scroll horizontally through history.</p>
    </section>;}
  function renderDetails(){return <section className="evolution-panel"><h3>{current?label(current):"Milestone details"}</h3>{current?<><p>{date(current.timestamp)} · {words(current.actor)} · Event {current.sequence}</p>{current.type==="journal_milestone"&&<><p>{current.history.some(h=>h.type==="object_created")?"Journal created in this interval":"Existing journal updated in this interval"} · {current.history.filter(h=>h.type==="journal_saved").length} autosaves</p><p>Last activity: {date(current.history[current.history.length-1].timestamp)}</p><details><summary>View underlying events ({current.history.length})</summary><ul>{current.history.map(h=><li key={h.id}>{words(h.type)} · {date(h.timestamp)}{h.details.revision!==undefined?` · revision ${h.details.revision}`:""}</li>)}</ul></details></>}{current.type===finding&&<p>Researcher assessment: {words(String(current.details.outcome))} · not independently verified{current.details.revision!==undefined?` · linked record revision ${current.details.revision}`:""}</p>}{current.details.note&&<p style={{whiteSpace:"pre-wrap"}}>{current.details.note}</p>}{current.type===checkpoint&&<><p>{current.details.object_count} research objects preserved.</p><button disabled={busy} onClick={()=>void inspectSnapshot()}>View saved snapshot</button><form onSubmit={async e=>{e.preventDefault();if(await action("branches",{checkpoint_id:current.id,title:branchName}))setBranchName("");}}><label>New exploration lane<input required maxLength={120} value={branchName} onChange={e=>setBranchName(e.target.value)}/></label><button disabled={busy||!branchName.trim()} className="evolution-primary">Create and switch to lane</button></form></>}{current.objects.length>0&&<ul>{current.objects.map(o=><li key={o.id}>{o.title||o.id} <small>(current record label)</small></li>)}</ul>}{current.operation_id&&<p>Operation: {current.operation_id}</p>}{current.details.proposal_id&&<p>Proposal: {current.details.proposal_id}</p>}{current.details.run_id&&<p>Run: {current.details.run_id}</p>}</>:<p>Select a node in the graph to inspect its history.</p>}
    {snapshot&&<div className="evolution-snapshot"><strong>Read-only checkpoint snapshot</strong><p>{snapshot.question}</p>{snapshot.objects.map(o=><details key={o.id}><summary>{o.title||o.type} · revision {o.currentRevision}</summary><p>{o.body}</p></details>)}<p>{snapshot.relationships.length} relationships preserved.</p></div>}</section>;}
  return <main className="evolution-page">
    <div className="evolution-heading"><div><p className="evolution-kicker">THE HISTORY OF DISCOVERY</p><h2>Research evolution<span>.</span></h2><p>Real milestones from your scientific workspace, preserved in order.</p></div><div className="evolution-graph-controls"><button onClick={()=>void refresh().then(()=>replayGrowth()).catch(e=>setError(String(e)))}>Refresh</button><button type="button" className="evolution-primary evolution-view-control" onClick={e=>openMaximized(e.currentTarget)}><Maximize2 size={16} aria-hidden="true"/> Full view</button></div></div>
    <ResearchLoading active={busy || (!data && !error)} label={busy ? "Preparing research milestone…" : "Loading research history…"} />
    {error&&<p role="alert" className="evolution-error">{error}</p>}
    {data&&<section className="evolution-panel"><div className="evolution-panel-title"><strong>Open explorations</strong><span>{openBranches.length} open · one tracking focus</span></div><p>Switch freely without closing a lane. Select Review only when you want to close one.</p><details className="evolution-tracking-help"><summary>About tracking &amp; checkpoints</summary><p>Activity is recorded in the selected lane. Research data and AI context are shared, not isolated. Finish running AI tasks and experiments before switching lanes. Checkpoints are read-only; AI proposals are not verified evidence.</p></details><div className="evolution-branch-list">
      <div className="evolution-branch-row"><div><strong>Main research</strong><p>{!data.active_branch?"Currently tracking":"Available"}</p></div><button className={!data.active_branch?"evolution-primary":""} disabled={busy||!data.active_branch} onClick={()=>void action("focus",{branch_id:null})}>{!data.active_branch?"Tracking":"Switch to main"}</button></div>
      {openBranches.map(b=><div className="evolution-branch-row" key={b.id}><div><strong>{b.title}</strong><p>{data.active_branch===b.id?"Currently tracking":"Open · not selected"} · {graph.nodes.filter(n=>graph.lanes[n.lane]?.id===b.id && ![start,focus,close].includes(n.event.type)).length} {raw?"events":"milestones"} · {data.events.filter(e=>e.type===finding&&e.details.branch_id===b.id).length} findings</p></div><div className="evolution-branch-actions"><button className={data.active_branch===b.id?"evolution-primary":""} disabled={busy||data.active_branch===b.id} onClick={()=>void action("focus",{branch_id:b.id})}>{data.active_branch===b.id?"Tracking":"Switch"}</button><button disabled={busy} onClick={()=>{setFindingBranch(b.id);setFindingTitle("");setFindingNote("");setFindingOutcome("observation");setFindingObject("");}}>+ Add finding</button><button disabled={busy} onClick={()=>{setReviewBranch(b.id);setOutcome("inconclusive");setReviewNote("");}}>Review / close</button></div></div>)}
    </div>{!openBranches.length&&<p>Select a checkpoint below to create your first exploration.</p>}</section>}
    {findingTarget&&<section className="evolution-panel"><h3>Add finding · {findingTarget.title}</h3><p>Record a researcher observation or assessment in this lane without switching focus. This is not automatically verified evidence.</p><form onSubmit={async e=>{e.preventDefault();if(await action(`branches/${findingTarget.id}/findings`,{title:findingTitle,note:findingNote,outcome:findingOutcome,object_id:findingObject||null})){setFindingBranch(null);setFindingTitle("");setFindingNote("");}}}><label>Finding title<input required maxLength={120} value={findingTitle} onChange={e=>setFindingTitle(e.target.value)} /></label><label>Finding and limitations<textarea required maxLength={4000} value={findingNote} onChange={e=>setFindingNote(e.target.value)} placeholder="What did you observe? What is still uncertain?" /></label><label>Assessment<select value={findingOutcome} onChange={e=>setFindingOutcome(e.target.value)}><option value="observation">Observation</option><option value="promising">Promising, not proven</option><option value="inconclusive">Inconclusive</option><option value="unsupported">Not supported by evidence</option></select></label><label>Link a research record (optional)<select value={findingObject} onChange={e=>setFindingObject(e.target.value)}><option value="">No linked record</option>{project.objects.map(o=><option key={o.id} value={o.id}>{o.type}: {o.title||"Untitled"}</option>)}</select></label><button className="evolution-primary" disabled={busy||!findingTitle.trim()||!findingNote.trim()}>Save finding</button> <button type="button" disabled={busy} onClick={()=>setFindingBranch(null)}>Cancel</button></form></section>}
    {renderTimeline(false)}
    <dialog ref={dialogRef} onClose={closeMaximized} className="evolution-page evolution-max-dialog" aria-labelledby="evolution-max-title">
      {maximized&&<div className={`evolution-max-layout${showInspector?"":" evolution-max-graph-only"}`}>{renderTimeline(true)}{showInspector&&<aside className="evolution-max-inspector">{error&&<p role="alert" className="evolution-error">{error}</p>}{renderDetails()}</aside>}</div>}
    </dialog>
    <div className="evolution-grid"><section className="evolution-panel"><h3>Save a checkpoint</h3><p>Preserve current research objects and graph state for later review.</p><form onSubmit={async e=>{e.preventDefault();if(await action("checkpoints",{title:name,note})){setName("");setNote("");}}}><label>Checkpoint name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} /></label><label>Review notes<textarea maxLength={4000} value={note} onChange={e=>setNote(e.target.value)} placeholder="What evidence did you review? What remains uncertain?"/></label><button className="evolution-primary" disabled={busy||!name.trim()}>Save checkpoint</button></form></section>
    {renderDetails()}</div>
    {reviewTarget&&<section className="evolution-panel"><h3>Review exploration lane</h3><p>{reviewTarget.title}. Closing this lane records your assessment, without closing other lanes or changing research data.</p><form onSubmit={async e=>{e.preventDefault();if(await action(`branches/${reviewTarget.id}/close`,{outcome,note:reviewNote})){setReviewNote("");setReviewBranch(null);}}}><label>Researcher assessment<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="inconclusive">Inconclusive</option><option value="unsupported">Not supported by evidence</option><option value="promising">Promising, not proven</option><option value="paused">Paused</option></select></label><label>Review notes<textarea maxLength={4000} value={reviewNote} onChange={e=>setReviewNote(e.target.value)}/></label><button disabled={busy} className="evolution-primary">Close lane</button> <button type="button" disabled={busy} onClick={()=>setReviewBranch(null)}>Cancel</button></form></section>}
  </main>;
}
