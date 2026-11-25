"use client";

import { ResearchLoading } from "./research-loading";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { formatDate, type Project, type ResearchObject } from "@/lib/projects";
import { kernel } from "@/lib/kernel-repository";
import { useWorkspace } from "./workspace-provider";

type Revision = { revision_id: string; revision_number: number; title_snapshot: string; body_snapshot: string; created_at: string };
type Draft = { title: string; body: string; tags: string[]; linked_object_ids: string[] };
function fields(object: ResearchObject): Draft { return { title: object.title, body: object.body, tags: (object.metadata?.tags as string[]) ?? [], linked_object_ids: (object.metadata?.linked_object_ids as string[]) ?? [] }; }

export function JournalEntry({ object, project, collapsible = false, defaultOpen = true }: { object: ResearchObject; project: Project; collapsible?: boolean; defaultOpen?: boolean }) {
  const { registerSaver, draftChanged } = useWorkspace();
  const [expanded, setExpanded] = useState(defaultOpen);
  const [draft, setDraft] = useState(() => fields(object));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(true);
  const [history, setHistory] = useState<Revision[] | null>(null);
  const current = useRef(draft), dirty = useRef(false), revision = useRef(object.currentRevision ?? 1);
  const flight = useRef<Promise<void> | null>(null), failed = useRef(false);
  const save = useCallback(async () => {
    if (flight.current) return flight.current;
    if (!dirty.current) return;
    if (failed.current) throw new Error("Journal draft needs review before retrying. Your writing remains in the editor.");
    flight.current = (async () => {
      while (dirty.current) {
        const snapshot = current.current;
        try {
          const result = await kernel<ResearchObject>(`projects/${object.projectId}/journal/${object.id}`, "PATCH", { ...snapshot, base_revision: revision.current });
          revision.current = result.currentRevision ?? revision.current;
          dirty.current = current.current !== snapshot;
          setSaved(!dirty.current); setError("");
        } catch (e) { failed.current = true; setError(String(e)); throw e; }
      }
    })();
    try { await flight.current; } finally { flight.current = null; }
  }, [object.id, object.projectId]);
  useEffect(() => { const unregister=registerSaver(object.id, { save, dirty: () => dirty.current }); return()=>{ void save().catch(()=>{}); unregister(); }; }, [registerSaver, object.id, save]);
  useEffect(() => {
    let active=true;
    void Promise.resolve().then(()=>{
      if(active && !dirty.current && (object.currentRevision ?? 1)>revision.current){
        revision.current=object.currentRevision ?? 1;current.current=fields(object);setDraft(current.current);
      }
    });
    return()=>{active=false;};
  }, [object]);
  useEffect(() => {
    const timer = setTimeout(() => { void save().catch(() => {}); }, 1500);
    return () => clearTimeout(timer);
  }, [draft, save]);
  function edit(patch: Partial<Draft>) {
    current.current = { ...current.current, ...patch }; dirty.current = true;
    setDraft(current.current); setSaved(false); draftChanged();
  }
  async function viewHistory() { try { setHistory(await kernel<Revision[]>(`projects/${project.id}/objects/${object.id}/revisions`)); } catch (e) { setError(String(e)); } }
  async function retry() {
    try {
      const latest = await kernel<ResearchObject>(`projects/${project.id}/objects/${object.id}`);
      if (window.confirm("Save this draft as a new revision over the latest saved entry? Review saved revisions first if another session edited it.")) {
        revision.current = latest.currentRevision ?? 1; failed.current = false; await save();
      }
    } catch (e) { setError(String(e)); }
  }
  useEffect(() => {
    if (!collapsible) return;
    const openLinked = () => {
      if (window.location.hash === `#research-${object.id}`) setExpanded(true);
    };
    openLinked();
    window.addEventListener("hashchange", openLinked);
    return () => window.removeEventListener("hashchange", openLinked);
  }, [collapsible, object.id]);
  const contentId = `journal-content-${object.id}`;
  return <article id={`research-${object.id}`} className={collapsible ? "journal-entry journal-card" : "journal-entry"} aria-label={`Journal: ${draft.title || "Untitled entry"}`}>
    {collapsible && <button type="button" className="journal-card-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
      <span className="journal-card-text"><span className="journal-card-meta">{formatDate(object.createdAt)} · {error ? "Save needs review" : saved ? "Saved locally" : "Unsaved writing"}</span><strong>{draft.title.trim() || "Untitled journal entry"}</strong>{!expanded && <span className="journal-card-preview">{draft.body.trim().replace(/\s+/g, " ") || "No writing yet."}</span>}</span><ChevronDown size={20} />
    </button>}
    <div id={contentId} className={collapsible ? "journal-card-content" : undefined} hidden={collapsible && !expanded}>
    <div className="journal-dateline"><time dateTime={object.createdAt}>{formatDate(object.createdAt)}</time><span role="status">{saved ? "Saved locally" : "Unsaved writing"}</span></div>
    <input aria-label="Journal title" className="entry-title" value={draft.title} onChange={e => edit({ title:e.target.value })} placeholder="A day of research" maxLength={120} />
    <textarea aria-label="Journal writing" className="entry-body journal-writing" rows={8} value={draft.body} onChange={e => {e.target.style.height="auto";e.target.style.height=`${e.target.scrollHeight}px`;edit({ body:e.target.value });}} placeholder="What did you notice, question, or come to understand today?" maxLength={1000000} />
    <details className="journal-details"><summary>Tags, linked research & revisions</summary>
      <label>Tags<input aria-label="Journal tags" defaultValue={draft.tags.join(", ")} onBlur={e => edit({ tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) })} placeholder="Optional, separated by commas" /></label>
      <label>Link a research object<select aria-label="Link journal to research object" value="" onChange={e => edit({ linked_object_ids: [...new Set([...draft.linked_object_ids, e.target.value])] })}><option value="">Choose an existing object…</option>{project.objects.filter(o => o.id !== object.id).map(o => <option key={o.id} value={o.id}>{o.title || o.type}</option>)}</select></label>
      {draft.linked_object_ids.map(id => <button className="text-button" key={id} onClick={() => edit({ linked_object_ids: draft.linked_object_ids.filter(v => v !== id) })}>{project.objects.find(o => o.id === id)?.title ?? id} · Unlink</button>)}
      <button className="text-button" onClick={() => void viewHistory()}>View saved revisions</button>
      {history?.map(r => <details key={r.revision_id}><summary>Revision {r.revision_number} · {formatDate(r.created_at)}</summary><h4>{r.title_snapshot}</h4><p className="preserve-writing">{r.body_snapshot}</p></details>)}
    </details>
    {error && <div role="alert"><p>{error}</p><p>Your current draft remains here. Copy it before closing this page.</p><button className="text-button" onClick={() => void retry()}>Review and retry saving</button><button className="text-button" onClick={() => void viewHistory()}>Inspect saved revisions</button></div>}
    </div>
  </article>;
}

export function ResearchJournal({ project }: { project: Project }) {
  const { sync } = useWorkspace();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const entries = project.objects.filter(o => o.metadata?.journal_entry).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  async function add() {
    setBusy(true);
    try { await sync(); await kernel(`projects/${project.id}/journal`, "POST", { id: crypto.randomUUID(), title: "", body: "" }); await sync(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section aria-label="Research journal" className="research-journal notebook-card">
    <ResearchLoading active={busy} label="Preparing journal entry…" />
    <div className="entries-heading"><h3>Research journal <span>{entries.length}</span></h3><button className="text-button" disabled={busy} onClick={() => void add()}><Plus size={16} />New journal entry</button></div>
    {!entries.length && <p className="notebook-empty">Write freely. Your questions, observations and unfinished ideas belong here.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="journal-card-list">{entries.map((object, index) => <JournalEntry key={object.id} object={object} project={project} collapsible defaultOpen={index === 0} />)}</div>
  </section>;
}
