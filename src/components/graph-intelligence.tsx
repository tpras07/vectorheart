"use client";

import { ResearchLoading } from "./research-loading";

import { useCallback, useEffect, useRef, useState } from "react";
import { Network, Sparkles, X } from "lucide-react";
import { type Project, type ResearchObject } from "@/lib/projects";
import { kernel } from "@/lib/kernel-repository";
import { useWorkspace } from "./workspace-provider";

type Passage = { object_id: string; revision: number; excerpt: string };
type Interpretation = { id: string; existing_object_id: string | null; object_type: string; title: string; body: string; rationale: string; uncertainty: string; sources: Passage[] };
type InterpretationEdge = { id: string; source: string; target: string; relationship_type: string; rationale: string; uncertainty: string; sources: Passage[] };
export type ScientificProposal = { id: string; action_type: string; status: string; payload: { title: string; content: string; rationale: string; assumptions: string[]; predictions: string[]; limitations: string[]; referenced_object_ids: string[]; target_object_id: string | null; source_object_id?: string; relationship_type?: string; literature_source_ids?:string[]; executable: boolean; adapter_id: string | null; adapter_parameters: Record<string, unknown> | null; original_statement?: string }; result_ids: { object_id?: string; operation_id?: string }; provenance: Record<string, unknown> };
type Step = { id: string; kind: string; status: string; operation_id: string | null; result: { answer?: string; evidence_ids?: string[]; execution_id?: string; execution_recorded?: boolean; proposal_id?: string } };
export type ResearchRun = { id: string; kind: "graph" | "accelerate" | "investigate" | "literature"; status: string; objective: string; model_requests: number; steps_used: number; tool_executions: number; error: string | null; config: { provider: string; model: string; max_steps: number; chunk_count: number }; steps: Step[]; output: { nodes?: Interpretation[]; edges?: InterpretationEdge[]; summaries?: string[]; diagnostics?: string[]; summary?: string; limitations?: string[]; stop_reason?: string } };
export type GraphOverlay = { nodes: ResearchObject[]; edges: { id: string; sourceId: string; targetId: string; type: string; novel: boolean }[] };
const EMPTY_OVERLAY: GraphOverlay = { nodes: [], edges: [] };

export function overlayFor(run: ResearchRun | undefined, proposals: ScientificProposal[], project: Project): GraphOverlay {
  if (!run) return EMPTY_OVERLAY;
  const nodes: ResearchObject[] = [], edges: GraphOverlay["edges"] = [];
  const make = (id: string, title: string, body: string, type: ResearchObject["type"], metadata: Record<string, unknown>) => nodes.push({ id, projectId: project.id, title, body, type, metadata, createdAt: "", updatedAt: "" });
  if (run.kind === "graph" && run.status === "review") {
    for (const n of run.output.nodes ?? []) make(n.id, n.title, n.body, (n.object_type[0].toUpperCase() + n.object_type.slice(1)) as ResearchObject["type"], { provisional: true, origin: "model_interpretation", preview_id: n.id, rationale: n.rationale, interpretation_uncertainty: n.uncertainty });
    for (const e of run.output.edges ?? []) edges.push({ id: `preview-${e.id}`, sourceId: e.source, targetId: e.target, type: e.relationship_type, novel: false });
  }
  for (const p of proposals.filter(p => p.status === "pending" || (p.action_type === "propose_experiment" && run.steps.some(s=>s.result.proposal_id===p.id && !s.result.execution_recorded)))) {
    const v = p.payload, id = `proposal-${p.id}`;
    const prepared = p.action_type === "propose_experiment" ? run.steps.find(s => s.result.proposal_id===p.id && s.operation_id && !s.result.execution_recorded) : undefined;
    if (p.action_type === "propose_relationship" && v.source_object_id && v.target_object_id) {
      edges.push({ id, sourceId: v.source_object_id, targetId: v.target_object_id, type: v.relationship_type ?? "related_to", novel: true });
    } else {
      const type = p.action_type === "create_hypothesis" || p.action_type === "propose_revision" ? "Hypothesis" : p.action_type === "create_question" ? "Question" : p.action_type === "create_observation" ? "Observation" : p.action_type === "propose_experiment" ? "Experiment" : "Concept";
      make(id, v.title, v.content, type, { provisional: true, origin: "ai_accelerate", proposal_id: p.id, rationale: v.rationale, experiment_state: prepared ? run.status : p.action_type === "propose_experiment" ? v.executable ? "Proposed · separate approval" : "Conceptual / unavailable" : undefined });
      for (const source of [...new Set([...v.referenced_object_ids, ...(v.target_object_id ? [v.target_object_id] : [])])]) edges.push({ id: `${id}-${source}`, sourceId: id, targetId: source, type: p.action_type === "propose_experiment" ? "tests" : "related_to", novel: true });
    }
  }
  const ids = new Set(nodes.map(n => n.id));
  for (const edge of edges) for (const id of [edge.sourceId, edge.targetId]) {
    if (!ids.has(id)) { const object = project.objects.find(o => o.id === id); if (object) { nodes.push(object); ids.add(id); } }
  }
  return { nodes, edges };
}

function Sources({ ids, project }: { ids: string[]; project: Project }) {
  return <div className="proposal-sources">{ids.map(id => <a key={id} href={`/projects/${project.id}/notebook#research-${id}`}>{project.objects.find(o => o.id === id)?.title || "Source research"}</a>)}</div>;
}

export function GraphIntelligence({ project, onOverlay, inspection, closeInspection }: { project: Project; onOverlay: (overlay: GraphOverlay) => void; inspection: string | null; closeInspection: () => void }) {
  const { sync } = useWorkspace();
  const [runs, setRuns] = useState<ResearchRun[]>([]), [selected, setSelected] = useState("");
  const [proposals, setProposals] = useState<ScientificProposal[]>([]);
  const [objective, setObjective] = useState(""), [maxSteps, setMaxSteps] = useState(3);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [rationale, setRationale] = useState("");
  const [configuration, setConfiguration] = useState("");
  const [reasoningConfiguration, setReasoningConfiguration] = useState("");
  const investigationDetails = useRef<HTMLDetailsElement>(null);
  const investigationInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    function investigate(event: Event) {
      const detail = (event as CustomEvent<{ projectId: string; objective: string }>).detail;
      if (detail.projectId !== project.id) return;
      setObjective(detail.objective);
      if (investigationDetails.current) investigationDetails.current.open = true;
      investigationInput.current?.focus();
      investigationDetails.current?.scrollIntoView?.({ behavior: "auto", block: "center" });
    }
    window.addEventListener("vectorheart-investigate", investigate);
    return () => window.removeEventListener("vectorheart-investigate", investigate);
  }, [project.id]);
  const [operation, setOperation] = useState<{ id: string; status: string; rationale: string; specification?: { parameters: Record<string, unknown>; predicted_outcomes: unknown; measurement_plan: string; validation_plan: string[] } } | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const path = `projects/${project.id}/research-runs`;
  const run = runs.find(r => r.id === selected);
  const refresh = useCallback(async () => {
    const list = (await kernel<ResearchRun[]>(path)).filter(r=>r.kind!=="literature"); setRuns(list);
    const id = selectedRef.current || list[0]?.id;
    if (id) { setSelected(id); setProposals(await kernel<ScientificProposal[]>(`${path}/${id}/proposals`)); }
  }, [path]);
  useEffect(() => {
    let live = true;
    const load = async () => { if (live) try { await refresh(); } catch (e) { if (live) setError(String(e)); } };
    void load(); const interval = setInterval(() => void load(), 2500);
    return () => { live = false; clearInterval(interval); };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    void kernel<{ providers: { provider: string; default_model: string | null; available: boolean }[]; priority: string[] }>("intelligence/providers").then(data => {
      function label(role: "Conceptual Synthesis" | "General Reasoning") {
        const assignment = project.settings.modelAssignments[role];
        const provider = assignment.provider === "Automatic" ? data.priority.map(name => data.providers.find(p => p.provider === name.trim() && p.available)).find(Boolean) : data.providers.find(p => p.provider === assignment.provider);
        const model = assignment.provider === "Automatic" ? provider?.default_model : assignment.modelId || provider?.default_model;
        return provider && model ? `${provider.provider} · ${model}` : "Configure a provider and model in project settings";
      }
      if (active) { setConfiguration(label("Conceptual Synthesis")); setReasoningConfiguration(label("General Reasoning")); }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [project.settings.modelAssignments]);
  useEffect(() => { onOverlay(overlayFor(run, proposals, project)); }, [run, proposals, project, onOverlay]);
  const pendingOperation = run?.steps.findLast(s => s.operation_id && !s.result.execution_recorded)?.operation_id;
  useEffect(() => {
    let active = true;
    if (!pendingOperation) return;
    void kernel<NonNullable<typeof operation>>(`projects/${project.id}/operations/${pendingOperation}`).then(op => { if (active) setOperation(op); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [pendingOperation, project.id, run?.status]);
  const lastStatus = useRef("");
  useEffect(() => {
    const key = run ? `${run.id}-${run.status}-${run.tool_executions}` : "";
    if (key && key !== lastStatus.current) {
      lastStatus.current = key;
      void sync().then(() => window.dispatchEvent(new Event("vectorheart-research-refresh"))).catch(e => setError(String(e)));
    }
  }, [run, sync]);
  async function action(suffix: string, data: unknown = {}) {
    setBusy(true); setError("");
    try { await sync(); await kernel(`${path}/${selected}/${suffix}`, "POST", data); await sync(); await refresh(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function start(kind: ResearchRun["kind"]) {
    setBusy(true); setError("");
    try {
      await sync(); const next = await kernel<ResearchRun>(path, "POST", { kind, objective, max_steps: maxSteps, idempotency_key: crypto.randomUUID() });
      selectedRef.current = next.id; setSelected(next.id); await refresh();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  const processing = busy || run?.status === "queued" || run?.status === "running";
  const processingLabel = run?.kind === "accelerate" ? "Preparing research proposals…" : run?.kind === "graph" ? "Preparing the research graph…" : "Preparing scientific investigation…";
  const proposal = proposals.find(p => inspection === `proposal-${p.id}`);
  const interpreted = run?.output.nodes?.find(n => inspection === n.id);
  const interpretedEdge = run?.output.edges?.find(e => inspection === `preview-${e.id}`);
  return <section className="graph-intelligence" aria-label="Graph intelligence">
    <div className="graph-primary-actions"><div><button className="text-button graph-generate" disabled={busy} onClick={() => void start("graph")}><Network size={18} />{project.placements.length > 0 || project.relationships.length > 0 || runs.some(r => r.kind === "graph" && r.status === "accepted") ? "Update Research Graph" : "Generate Research Graph"}</button><small>{configuration || "Reading model configuration…"}</small></div>
      <div><button className="text-button accelerate-action" disabled={busy} onClick={() => void start("accelerate")}><Sparkles size={17} />AI Accelerate</button><small>{reasoningConfiguration || "Reading model configuration…"}</small></div>
      <details ref={investigationDetails} className="investigate-launch"><summary>Investigate with tools</summary><small>{reasoningConfiguration}</small><label>Investigative objective<textarea ref={investigationInput} aria-label="Investigation objective" value={objective} onChange={e => setObjective(e.target.value)} maxLength={10000} placeholder="What should we try to distinguish or understand?" /></label><label>Maximum reasoning steps<select aria-label="Maximum investigation steps" value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(v => <option key={v}>{v}</option>)}</select></label><p>Registered tools only. Each experiment pauses for approval.</p><button className="text-button" disabled={busy || !objective.trim()} onClick={() => void start("investigate")}>Begin bounded investigation</button></details>
    </div>
    <ResearchLoading active={processing} label={busy ? "Processing research request…" : processingLabel} detail="The scientific workspace remains available while the request is in progress." />
    {error && <p role="alert">{error}</p>}
    {runs.length > 0 && <div className="graph-run-state"><select aria-label="Research run history" value={selected} onChange={e => { selectedRef.current = e.target.value; setSelected(e.target.value); void refresh(); }}>{runs.map(r => <option key={r.id} value={r.id}>{r.kind} · {r.status} · {r.id.slice(0, 8)}</option>)}</select><span role="status">{run?.status.replaceAll("_", " ")} · {run?.model_requests} model requests · {run?.tool_executions} tool executions</span>
      {run?.status === "review" && <><button className="text-button" disabled={busy} onClick={() => void action("accept-graph")}>Accept graph interpretation</button><button className="text-button" disabled={busy} onClick={() => void action("reject-graph", { rationale })}>Reject graph preview</button></>}
      {run && ["running", "queued", "awaiting_approval", "failed", "interrupted"].includes(run.status) && <><button className="text-button" disabled={busy} onClick={() => void action("resume")}>Resume / recover</button><button className="text-button" disabled={busy} onClick={() => void action("cancel")}>Stop investigation</button></>}
    </div>}
    {run && <small className="graph-model-used">{run.config.provider} · {run.config.model}</small>}
    {run?.error && <p role="alert">{run.error}</p>}
    {run?.status === "awaiting_approval" && operation?.specification && <div className="investigation-approval"><h3>Approve this experiment?</h3><p>{operation.rationale}</p><p>Registered synthetic causal intervention. This approval permits one execution of the displayed frozen specification.</p><pre>{JSON.stringify(operation.specification.parameters, null, 2)}</pre><details><summary>Predictions, measurement and validation plan</summary><pre>{JSON.stringify(operation.specification, null, 2)}</pre></details><button className="text-button" disabled={busy} onClick={() => void action("approve")}>Approve experiment & resume</button><button className="text-button" disabled={busy} onClick={() => { void kernel(`projects/${project.id}/operations/${operation.id}/reject`, "POST").then(() => action("resume")).catch(e => setError(String(e))); }}>Reject experiment</button></div>}
    {run && <details className="graph-run-summary"><summary>{run.output.nodes?.length ?? proposals.length} {run.kind === "graph" ? "interpretations" : "scientific proposals"} · Run summary & trace</summary><p>{run.objective}</p><p className="preserve-writing">{run.output.summary || run.output.summaries?.join("\n\n")}</p>{run.output.stop_reason && <p>{run.output.stop_reason}</p>}{run.output.limitations?.map((v, i) => <p key={i}>{v}</p>)}{run.output.diagnostics?.map((v, i) => <p key={i}>Interpretation withheld: {v}</p>)}<ol>{run.steps.map(st => <li key={st.id}>{st.kind} · {st.status}{st.operation_id && <> · operation {st.operation_id}</>}{st.result.evidence_ids?.length ? <> · {st.result.evidence_ids.length} recorded evidence object(s)</> : null}</li>)}</ol><div className="proposal-summary-list">{proposals.map(p => <div key={p.id}><span>{p.payload.title} · {p.status}</span>{p.status === "pending" && <><button className="text-button" disabled={busy} onClick={() => void action(`proposals/${p.id}/accept`, { rationale })}>Accept {p.payload.title}</button><button className="text-button" disabled={busy} onClick={() => void action(`proposals/${p.id}/reject`, { rationale })}>Reject {p.payload.title}</button></>}</div>)}</div></details>}
    {(proposal || interpreted || interpretedEdge) && <aside className="graph-inspector" aria-label="Review graph interpretation or proposal"><button className="icon-button inspector-close" aria-label="Close graph inspection" onClick={closeInspection}><X size={18} /></button>
      {proposal ? <><p className="eyebrow">{proposal.action_type.replaceAll("_", " ")} · {proposal.status}</p><h3>{proposal.payload.title}</h3>{proposal.payload.original_statement && <><h4>Original statement</h4><p>{proposal.payload.original_statement}</p><h4>Proposed statement</h4></>}<p className="preserve-writing">{proposal.payload.content}</p><p>{proposal.payload.rationale}</p>{(["assumptions", "predictions", "limitations"] as const).map(key => proposal.payload[key].length > 0 && <div key={key}><h4>{key}</h4><ul>{proposal.payload[key].map((v, i) => <li key={i}>{v}</li>)}</ul></div>)}<Sources ids={proposal.payload.referenced_object_ids} project={project} />{proposal.payload.literature_source_ids?.map(id=><button className="text-button" key={id} onClick={()=>window.dispatchEvent(new CustomEvent("vectorheart-literature-inspect",{detail:{projectId:project.id,sourceId:id}}))}>Inspect cited literature</button>)}{proposal.action_type === "propose_experiment" && <><p>{proposal.payload.executable ? "Executable draft · separate approval required" : "Conceptual experiment — execution not yet available."}</p><pre>{JSON.stringify(proposal.payload.adapter_parameters, null, 2)}</pre></>}<label>Optional review rationale<textarea aria-label="Proposal review rationale" value={rationale} onChange={e => setRationale(e.target.value)} maxLength={4000} /></label>{proposal.status === "pending" && <div className="dialog-actions"><button className="text-button" disabled={busy} onClick={() => void action(`proposals/${proposal.id}/accept`, { rationale })}>Accept proposal</button><button className="text-button" disabled={busy} onClick={() => void action(`proposals/${proposal.id}/reject`, { rationale })}>Reject proposal</button></div>}</> : <><p className="eyebrow">Interpretation · {interpreted?.uncertainty ?? interpretedEdge?.uncertainty}</p><h3>{interpreted?.title ?? interpretedEdge?.relationship_type}</h3><p>{interpreted?.body}</p><p>{interpreted?.rationale ?? interpretedEdge?.rationale}</p>{(interpreted?.sources ?? interpretedEdge?.sources ?? []).map((source, i) => <blockquote key={i}><p>{source.excerpt}</p><Sources ids={[source.object_id]} project={project} /><small>Source revision {source.revision}</small></blockquote>)}<p>{run?.config.provider} · {run?.config.model}. Review the complete preview before accepting. Source writing is preserved.</p></>}
    </aside>}
  </section>;
}
