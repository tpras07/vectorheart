"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Node, type NodeProps, type OnNodesChange } from "@xyflow/react";
import { BookOpen, MousePointer2, Minus, Pencil, Plus, X } from "lucide-react";
import { newObject, OBJECT_TYPES, type ObjectType, type Project, type ResearchObject } from "@/lib/projects";
import { useWorkspace } from "./workspace-provider";
import { LiteratureIntelligence } from "./literature-intelligence";
import { GraphIntelligence, type GraphOverlay } from "./graph-intelligence";
import { JournalEntry } from "./research-journal";
import { GraphCorrectionEditor } from "./graph-correction-editor";
import { RecordedExperiment } from "./research-actions";
import { ResearchEntry, TYPE_ICONS } from "./research-entry";

type ToolMode = "select" | "connect" | "disconnect";
type ResearchNode = Node<{ object: ResearchObject; edit: (id: string) => void; mode: ToolMode; endpoint: boolean; challenged?:boolean }, "research">;
function ResearchNodeView({ data, selected }: NodeProps<ResearchNode>) {
  const Icon = data.object.metadata?.literature_source_id ? BookOpen : TYPE_ICONS[data.object.type];
  return <div className={`research-node node-type-${data.object.type.toLowerCase()} ${data.object.type === "Question" || data.object.metadata?.interpretation_uncertainty === "uncertain" ? "node-uncertain" : ""} ${data.challenged ? "node-challenged" : ""} ${data.object.metadata?.literature_source_id ? "node-literature" : ""} ${selected ? "node-selected" : ""} ${data.endpoint ? "node-endpoint" : ""} ${data.object.metadata?.origin === "ai_accelerate" ? "node-novel" : ""} ${data.object.metadata?.provisional ? "node-provisional" : ""}`}>
    <Handle type="target" position={Position.Left} isConnectable={data.mode === "select" && !data.object.metadata?.provisional} aria-label="Incoming connection" />
    <div className="node-type"><Icon size={14} /><span>{data.object.metadata?.origin==="literature_interpretation"?"Literature claim":data.object.metadata?.literature_source_id?"Paper":data.object.type}</span><button className="icon-button nodrag" disabled={data.mode !== "select"} aria-label={`Edit ${data.object.title || "Untitled"}`} onClick={event => { event.stopPropagation(); data.edit(data.object.id); }}><Pencil size={14} /></button></div>
    <h3>{data.object.type === "Question" ? "? " : ""}{data.object.title || "Untitled"}</h3>{data.challenged && <small>△ Challenging evidence / claim</small>}{!!data.object.metadata?.researcher_corrected && <small>Researcher corrected</small>}{!!data.object.metadata?.interpretation_uncertainty && <small>{String(data.object.metadata.interpretation_uncertainty)} interpretation</small>}{!!data.object.metadata?.experiment_state && <small>{String(data.object.metadata.experiment_state)}</small>}{data.object.type==="Experiment" && data.object.provenanceType==="experiment_runner" && !!data.object.metadata?.run_id && <small>Completed · simulation</small>}{!!data.object.metadata?.conceptual_experiment && <small>Conceptual · execution unavailable</small>}{data.object.body && <p>{data.object.body}</p>}
    <div className="node-origin">{data.object.metadata?.provisional ? "For review" : data.object.metadata?.literature_source_id ? "Published source" : data.object.metadata?.origin === "ai_accelerate" ? "AI contribution · accepted" : data.object.metadata?.origin === "model_interpretation" ? "Source-grounded interpretation" : data.object.type === "Evidence" ? "Inspect evidence & provenance" : "Research record"}</div>
    <Handle type="source" position={Position.Right} isConnectable={data.mode === "select" && !data.object.metadata?.provisional} aria-label="Outgoing connection" />
  </div>;
}
const nodeTypes = { research: ResearchNodeView };

function ObjectDialog({ object, project, close }: { object: ResearchObject; project: Project; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const {sync}=useWorkspace();
  const finish=()=>{void sync().then(close).catch(()=>{});};
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="object-dialog" aria-label="Edit research entry" onCancel={event=>{event.preventDefault();finish();}} onClick={event => { if (event.target === event.currentTarget) finish(); }}>
    <div className="object-dialog-header"><span>Shared with your Notebook</span><button className="icon-button" aria-label="Close entry editor" onClick={finish}><X size={18} /></button></div>
    {object.type === "Hypothesis" && <section className="hypothesis-actions" aria-label="Investigate this hypothesis"><p className="field-label">Where could this idea lead?</p><div>{([
      ["Suggest experiment", "Design Experiment", "Suggest a discriminating experiment for this hypothesis. Explain competing predictions and use registered tools only when scientifically appropriate; otherwise propose a conceptual design."],
      ["Explore alternatives", "Challenge", "What alternative explanations and hidden assumptions could challenge this hypothesis? Propose a useful, testable alternative."],
      ["Suggest future directions", "Synthesize", "Based on this hypothesis and the project's evidence, suggest the most informative next research direction. Distinguish speculation from established findings."],
    ] as const).map(([label, mode, prompt]) => <button className="text-button" key={label} onClick={() => { void sync().then(() => { close(); window.dispatchEvent(new CustomEvent("vectorheart-discuss", { detail: { projectId: project.id, objectId: object.id, mode, prompt } })); }).catch(() => {}); }}>{label}</button>)}<button className="text-button" onClick={() => { void sync().then(() => { close(); window.dispatchEvent(new CustomEvent("vectorheart-investigate", { detail: { projectId: project.id, objective: `Investigate this hypothesis: ${object.title}. ${object.body}`.slice(0, 10000) } })); }).catch(() => {}); }}>Investigate with tools</button></div></section>}
    <div className="literature-actions">{([['ground','Ground in Literature'],['challenge','Challenge with Literature']] as const).map(([action,label])=><button key={action} className="text-button" onClick={()=>{void sync().then(()=>{close();window.dispatchEvent(new CustomEvent('vectorheart-literature-action',{detail:{projectId:project.id,objectId:object.id,action}}));}).catch(()=>{});}}>{label}</button>)}</div>
    <p>Revision {object.currentRevision ?? 1} · {object.provenanceType ?? "human"} · {String(object.metadata?.origin ?? "research record")}</p>
    {typeof object.metadata?.run_id==="string" && ["Experiment","Evidence"].includes(object.type) && <RecordedExperiment projectId={project.id} runId={object.metadata.run_id} />}
    {Array.isArray(object.metadata?.source_passages) && <details open><summary>Original source passages</summary>{(object.metadata.source_passages as {object_id:string;revision:number;excerpt:string}[]).map((source,i)=><blockquote key={i}><p>{source.excerpt}</p><a href={`/projects/${object.projectId}/notebook#research-${source.object_id}`}>Source · revision {source.revision}</a></blockquote>)}</details>}
    {object.metadata?.journal_entry ? <JournalEntry object={object} project={project} /> : object.metadata?.origin === "model_interpretation" ? <GraphCorrectionEditor object={object} done={close} /> : <ResearchEntry object={object} onDelete={close} autoFocus />}
    <button className="text-button" onClick={finish}>Done</button>
  </dialog>;
}

export function ResearchCanvas({ project }: { project: Project }) {
  return <ReactFlowProvider key={project.id}><CanvasSurface project={project} /></ReactFlowProvider>;
}

function CanvasSurface({ project }: { project: Project }) {
  const { mutate, flush } = useWorkspace();
  const [intelligenceOverlay, setOverlay] = useState<GraphOverlay>({nodes:[],edges:[]});
  const [literatureOverlay,setLiteratureOverlay]=useState<GraphOverlay>({nodes:[],edges:[]});
  const literatureChanged=useCallback((value:GraphOverlay)=>setLiteratureOverlay(value),[]);
  const overlay=useMemo(()=>({nodes:[...intelligenceOverlay.nodes,...literatureOverlay.nodes.filter(n=>!intelligenceOverlay.nodes.some(o=>o.id===n.id))],edges:[...intelligenceOverlay.edges,...literatureOverlay.edges]}),[intelligenceOverlay,literatureOverlay]);
  const [inspection,setInspection]=useState<string|null>(null);
  const overlayChanged=useCallback((value:GraphOverlay)=>setOverlay(value),[]);
  const closeInspection=useCallback(()=>setInspection(null),[]);
  const flow = useReactFlow<ResearchNode>();
  const surface = useRef<HTMLDivElement>(null);
  const lastToolClick = useRef(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [newType, setNewType] = useState<ObjectType>("Note");
  const [existingId, setExistingId] = useState("");
  const [mode, setMode] = useState<ToolMode>("select");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const changeMode = useCallback((next: ToolMode) => {
    setMode(next); setEndpoint(null); setCandidates([]); setFeedback("");
    setSelectedNodes([]); setSelectedEdge(null);
  }, []);
  useEffect(() => {
    function cancel(event: KeyboardEvent) { if (event.key === "Escape") changeMode("select"); }
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [changeMode]);
  useEffect(() => () => { flush(); }, [flush]);
  const editing = project.objects.find(o => o.id === editingId);
  const placedIds = useMemo(() => new Set(project.placements.map(p => p.objectId)), [project.placements]);
  const unplaced = project.objects.filter(o => !placedIds.has(o.id));
  const placedNodes: ResearchNode[] = useMemo(() => project.placements.flatMap(placement => {
    const object = project.objects.find(o => o.id === placement.objectId);
    return object ? [{ id: object.id, type: "research" as const, position: placement.position, selected: selectedNodes.includes(object.id), data: { object, edit: (id:string)=>{const source=project.objects.find(o=>o.id===id)?.metadata?.literature_source_id;if(source)setInspection(`source-${String(source)}`);else setEditingId(id);}, mode, endpoint: endpoint === object.id, challenged: project.relationships.some(r=>r.type==="challenges" && (r.sourceId===object.id || r.targetId===object.id)) }, ariaLabel: `${object.type}: ${object.title || "Untitled"}` }] : [];
  }), [project.placements, project.objects, project.relationships, selectedNodes, mode, endpoint]);
  const nodes: ResearchNode[] = useMemo(()=>{
    const known=new Set(placedNodes.map(n=>n.id)); const x=Math.max(-340,...placedNodes.map(n=>n.position.x))+340;
    return [...placedNodes,...overlay.nodes.filter(o=>!known.has(o.id)).map((object,i)=>({id:object.id,type:"research" as const,position:{x:x+(i%3)*340,y:Math.floor(i/3)*230},draggable:false,selectable:true,data:{object,edit:setInspection,mode,endpoint:false},ariaLabel:`Provisional ${object.type}: ${object.title}`}))];
  },[placedNodes,overlay,mode]);
  const edges = useMemo(() => project.relationships.filter(r => placedIds.has(r.sourceId) && placedIds.has(r.targetId)).map(r => ({ id: r.id, source: r.sourceId, target: r.targetId, type: "smoothstep", label: String(r.details?.literature_classification ?? r.type ?? "related_to").replaceAll("_", " "), selected: selectedEdge === r.id, labelStyle: { fontSize: 10, fill: "#655576" }, labelBgStyle: { fill: "#faf9fe", fillOpacity: .96 }, markerEnd: { type: MarkerType.ArrowClosed, color: r.details?.origin === "ai_accelerate" ? "#448357" : r.type === "challenges" ? "#a36b58" : r.type === "supports" ? "#5c8563" : r.type === "tests" || r.type === "produces" ? "#6b829b" : "#a28aba" }, style: { stroke: r.details?.origin === "ai_accelerate" ? "#448357" : r.type === "challenges" ? "#a36b58" : r.type === "supports" ? "#5c8563" : r.type === "tests" || r.type === "produces" ? "#6b829b" : "#a28aba", strokeWidth: selectedEdge === r.id || (mode === "disconnect" && (r.sourceId === endpoint || r.targetId === endpoint)) ? 2.5 : 1.3 }, ariaLabel: `Connection from ${project.objects.find(o => o.id === r.sourceId)?.title || "Untitled"} to ${project.objects.find(o => o.id === r.targetId)?.title || "Untitled"}` })), [project.relationships, project.objects, placedIds, selectedEdge, mode, endpoint]);

  const onNodesChange: OnNodesChange<ResearchNode> = useCallback(changes => {
    for (const change of changes) {
      if (mode === "select" && change.type === "position" && change.position && placedIds.has(change.id)) mutate({ kind: "place", projectId: project.id, placement: { objectId: change.id, position: change.position } });
      if (change.type === "select") setSelectedNodes(ids => change.selected ? [...new Set([...ids, change.id])] : ids.filter(id => id !== change.id));
    }
  }, [mutate, project.id, mode, placedIds]);
  function centerPosition() {
    const rect = surface.current?.getBoundingClientRect();
    return rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 130, y: rect.top + rect.height / 2 - 60 }) : { x: 80, y: 80 };
  }
  function connect(connection: Pick<Connection, "source" | "target">) {
    if (!connection.source || !connection.target || connection.source === connection.target || !placedIds.has(connection.source) || !placedIds.has(connection.target)) return false;
    if (project.relationships.some(r => r.sourceId === connection.source && r.targetId === connection.target && (!r.type || r.type === "related_to"))) {setFeedback("That directed connection already exists.");return false;}
    const rationale=window.prompt("Optional: why are these research objects related? This is your interpretation, not verified evidence.","");
    if(rationale===null)return false;
    return mutate({kind:"connect",projectId:project.id,relationship:{id:crypto.randomUUID(),projectId:project.id,sourceId:connection.source,targetId:connection.target,type:"related_to",details:{origin:"researcher_correction",rationale:rationale??""}}});
  }
  function disconnect(id:string){
    if(!project.relationships.some(r=>r.id===id))return;
    const rationale=window.prompt("Optional: why should this relationship be removed? This decision will guide future graph generation.","");
    if(rationale===null)return;
    mutate({kind:"disconnect",projectId:project.id,relationshipId:id,rationale:rationale??"",correctionId:crypto.randomUUID()});changeMode("select");
  }
  function chooseNode(id: string) {
    if (mode === "select") {const source=project.objects.find(o=>o.id===id)?.metadata?.literature_source_id;if(source){setInspection(`source-${String(source)}`);return;}if(!project.objects.some(o=>o.id===id)){setInspection(id);return;} setEditingId(id);window.dispatchEvent(new CustomEvent('vectorheart-object-focus',{detail:{projectId:project.id,objectId:id}}));return;}
    if(!placedIds.has(id))return;
    lastToolClick.current = Date.now();
    setCandidates([]); setFeedback("");
    if (!endpoint || !placedIds.has(endpoint)) { setEndpoint(id); return; }
    if (id === endpoint) { setFeedback("Choose a different entry."); return; }
    if (mode === "connect") {
      if (connect({ source: endpoint, target: id })) changeMode("select");
    } else {
      const matches = project.relationships.filter(r => (r.sourceId === endpoint && r.targetId === id) || (r.sourceId === id && r.targetId === endpoint));
      if (matches.length === 1) disconnect(matches[0].id);
      else if (matches.length > 1) setCandidates(matches.map(r => r.id));
      else setFeedback("These entries have no connection.");
    }
  }
  function removePlacements(ids: string[]) {
    for (const objectId of ids) mutate({ kind: "unplace", projectId: project.id, objectId });
    setSelectedNodes([]);
  }

  return <main className="canvas-workspace" aria-label="Research Canvas">
    <GraphIntelligence project={project} onOverlay={overlayChanged} inspection={inspection} closeInspection={closeInspection} />
    <LiteratureIntelligence project={project} onOverlay={literatureChanged} inspection={inspection} closeInspection={closeInspection} selection={selectedNodes} relationshipId={selectedEdge} />
    <div className="canvas-toolbar"><div className="canvas-create"><select aria-label="New node type" value={newType} onChange={e => setNewType(e.target.value as ObjectType)}>{OBJECT_TYPES.filter(t => !["Experiment", "Evidence"].includes(t)).map(type => <option key={type}>{type}</option>)}</select><button className="text-button" onClick={() => { const object = newObject(project.id, newType); mutate({ kind: "add-object", projectId: project.id, object, position: centerPosition() }); changeMode("select"); setEditingId(object.id); }}><Plus size={16} /> New entry</button></div>
      <div className="canvas-place"><select aria-label="Existing entry to place" value={existingId} onChange={e => setExistingId(e.target.value)}><option value="">Place an existing entry…</option>{unplaced.map(o => <option value={o.id} key={o.id}>{o.type}: {o.title || "Untitled"}</option>)}</select><button className="text-button" disabled={!unplaced.some(o => o.id === existingId)} onClick={() => { mutate({ kind: "place", projectId: project.id, placement: { objectId: existingId, position: centerPosition() } }); setExistingId(""); }}>Place</button></div>
      <div className="canvas-tools" role="group" aria-label="Canvas tools">{([["select", "Select", MousePointer2], ["connect", "Connect", Plus], ["disconnect", "Disconnect", Minus]] as const).map(([tool, label, Icon]) => <button key={tool} className="icon-button" aria-label={label} title={label} aria-pressed={mode === tool} onClick={() => changeMode(tool)}><Icon size={17} /></button>)}</div>
    </div>
    {candidates.length > 0 && <div className="relationship-picker" role="group" aria-label="Choose connection to remove"><span>Choose a connection to remove:</span>{project.relationships.filter(r => candidates.includes(r.id)).map(r => <button className="text-button" key={r.id} onClick={() => disconnect(r.id)}>{project.objects.find(o => o.id === r.sourceId)?.title || "Untitled"} &rarr; {project.objects.find(o => o.id === r.targetId)?.title || "Untitled"} &middot; {r.type || "Untyped"}</button>)}</div>}
    <div className={`canvas-surface canvas-mode-${mode}`} ref={surface}>
      <ReactFlow<ResearchNode> nodes={nodes} edges={[...edges,...overlay.edges.filter(e=>!edges.some(existing=>existing.source===e.sourceId&&existing.target===e.targetId&&existing.label===e.type.replaceAll("_"," "))).map(e=>({id:e.id,source:e.sourceId,target:e.targetId,label:e.type.replaceAll("_"," "),type:"smoothstep",style:{stroke:e.novel?"#59735c":"#7040c2",strokeDasharray:"5 4"},markerEnd:{type:MarkerType.ArrowClosed,color:e.novel?"#59735c":"#7040c2"}}))]} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onConnect={connect}
        onNodeClick={(event, node) => {if(event.shiftKey && mode==="select")return;chooseNode(node.id);}}
        onNodeDoubleClick={(_, node) => { if (mode === "select" && Date.now() - lastToolClick.current > 400) setEditingId(node.id); }}
        nodesDraggable={mode === "select"} nodesConnectable={mode === "select"}
        onKeyDown={event => { if (mode !== "select" && (event.key === "Enter" || event.key === " ")) { const node = (event.target as HTMLElement).closest(".react-flow__node"); const id = node?.getAttribute("data-id"); if (id) { event.preventDefault(); chooseNode(id); } } }}
        onEdgeClick={(_, edge) => { if (mode === "select") { if(overlay.edges.some(e=>e.id===edge.id)){setInspection(edge.id);return;} setSelectedEdge(edge.id);const relation=project.relationships.find(r=>r.id===edge.id);const source=project.objects.find(o=>o.id===relation?.sourceId)?.metadata?.literature_source_id;if(source)setInspection(`source-${String(source)}`); } }} onPaneClick={() => { setSelectedEdge(null); setEndpoint(null); setCandidates([]); setFeedback(""); }}
        onEdgesChange={changes => { for (const change of changes) if (change.type === "select") setSelectedEdge(id => change.selected ? change.id : id === change.id ? null : id); }}
        onBeforeDelete={async ({ nodes: deleting }) => !deleting.length || window.confirm("Remove selected entries and their visible connections from the Canvas? Their content stays in the Notebook.")}
        onNodesDelete={deleted => removePlacements(deleted.map(node => node.id))}
        onEdgesDelete={deleted => { for (const edge of deleted) disconnect(edge.id); }}
        isValidConnection={connection => connection.source !== connection.target && !project.relationships.some(r => r.sourceId === connection.source && r.targetId === connection.target && (!r.type || r.type === "related_to"))}
        fitView minZoom={0.15} maxZoom={2.5} deleteKeyCode={mode === "select" ? ["Backspace", "Delete"] : null} defaultEdgeOptions={{ interactionWidth: 24 }}>
        <Background variant={BackgroundVariant.Dots} gap={28} size={0.7} color="#ded2ef" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {!nodes.length && <div className="canvas-empty">Place a notebook entry or start a new thought.</div>}
      {mode === "select" && (selectedNodes.length > 0 || selectedEdge) && <div className="canvas-selection">{selectedNodes.length > 0 && <button className="text-button" onClick={() => { if (window.confirm("Remove selected entries from the Canvas? They will remain in the Notebook.")) removePlacements(selectedNodes); }}>Remove from canvas</button>}{selectedEdge && <button className="text-button" onClick={() => { disconnect(selectedEdge); setSelectedEdge(null); }}>Delete connection</button>}</div>}
    </div>
    {selectedEdge && <div className="graph-edge-inspection"><h3>{project.relationships.find(r=>r.id===selectedEdge)?.type?.replaceAll("_"," ")}</h3><p>{String(project.relationships.find(r=>r.id===selectedEdge)?.details?.rationale ?? "Researcher-created connection; no scientific rationale recorded.")}</p><details><summary>Relationship provenance</summary><pre>{JSON.stringify(project.relationships.find(r=>r.id===selectedEdge)?.details,null,2)}</pre></details></div>}
    <div className="graph-legend" aria-label="Graph visual key">{[["Hypothesis", "#795775"], ["Question / uncertainty", "#936b2b"], ["Observation", "#397b76"], ["Experiment", "#506e9a"], ["Evidence", "#50734d"], ["Literature", "#496e84"], ["AI proposal", "#267449"]].map(([label, color]) => <span key={label}><i aria-hidden="true" style={{ background: color }} />{label}</span>)}</div>
    <p className="canvas-help" role="status">{feedback || (mode === "select" ? "Drag to arrange · Connect the small handles · Double-click an entry to write" : mode === "connect" ? endpoint ? "Choose the target entry. Escape to cancel." : "Choose the source entry. Escape to cancel." : endpoint ? "Choose the other endpoint. Escape to cancel." : "Choose an endpoint to disconnect. Escape to cancel.")}</p>
    {editing && <ObjectDialog project={project} object={editing} close={() => setEditingId(null)} />}
  </main>;
}
