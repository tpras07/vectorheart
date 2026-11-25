"use client";

import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { newObject, OBJECT_TYPES, type ObjectType, type Project } from "@/lib/projects";
import { useWorkspace } from "./workspace-provider";
import { ResearchEntry, WritingField } from "./research-entry";
import { ResearchJournal } from "./research-journal";
import { ResearchActions } from "./research-actions";
import "./notebook-cards.css";

export function ProjectNotebook({ project }: { project: Project }) {
  const { update, mutate } = useWorkspace();
  const [type, setType] = useState<ObjectType>("Note");
  const [newId, setNewId] = useState<string | null>(null);
  const structured = project.objects.filter(o => !o.metadata?.journal_entry);
  return <main className="project-content research-document">
    <div className="section-intro"><p className="eyebrow">RESEARCH NOTEBOOK</p><h2>A place to think on paper.</h2></div>
    <section className="central-question notebook-card"><p className="field-label">Central research direction</p><WritingField label="Central research direction" className="question-input" value={project.question} onChange={question => update(project.id, { question })} placeholder="What would you like to understand?" multiline /></section>
    <ResearchJournal project={project} />
    <details className="notebook-tools notebook-card notebook-accordion"><summary>Scientific tools & research history <ChevronDown size={18} /></summary><ResearchActions project={project} /></details>
    <details className="structured-research notebook-card notebook-accordion" open={structured.length > 0}><summary>Structured research objects <span>{structured.length}</span><ChevronDown size={18} /></summary>
    <div className="entries-heading"><h3>Research entries <span>{structured.length}</span></h3><div className="entry-add"><select aria-label="New entry type" value={type} onChange={e => setType(e.target.value as ObjectType)}>{OBJECT_TYPES.filter(t => !["Experiment", "Evidence"].includes(t)).map(value => <option key={value}>{value}</option>)}</select><button className="text-button" onClick={() => { const object = newObject(project.id, type); if (mutate({ kind: "add-object", projectId: project.id, object })) setNewId(object.id); }}><Plus size={16} /> Add entry</button></div></div>
    {structured.length === 0 && <p className="notebook-empty">Begin with a question, an observation, or an idea.</p>}
    {structured.map(object => <ResearchEntry key={object.id} object={object} autoFocus={object.id === newId} />)}
    </details>
  </main>;
}
