"use client";

import Link from "next/link";
import { ResearchLoading } from "@/components/research-loading";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ArrowRight, Search, Plus, Pencil, Trash2, Sprout } from "lucide-react";
import { Brand } from "@/components/brand";
import { AboutVectorHeart } from "@/components/about-vectorheart";
import { ProjectDialog } from "@/components/project-dialog";
import { useWorkspace } from "@/components/workspace-provider";
import { formatDate, type Project } from "@/lib/projects";

export default function Home() {
  const { projects, ready, create, update, remove } = useWorkspace();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const filtered = projects.filter(p => `${p.title} ${p.description}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <div className="page-shell">
    <header className="site-header"><Brand /><div className="home-header-actions"><span className="header-note">A little room for big questions.</span><AboutVectorHeart /></div></header>
    <main className="home-main">
      <section className="welcome"><h1>Welcome to VectorHeart<span className="accent">.</span></h1></section>
      <section aria-label="Your projects" className="projects-section">
        <div className="projects-heading"><div className="flex items-baseline gap-3"><h2>Your projects</h2><span className="project-count">{String(projects.length).padStart(2, "0")}</span></div><button disabled={!ready} className="new-project" onClick={() => setEditing("new")}><Plus size={16} /> New project</button></div>
        <div className="search-field"><Search size={18} strokeWidth={1.5} /><input aria-label="Search projects" type="search" placeholder="Find a thought, a question, a project…" value={search} onChange={e => setSearch(e.target.value)} /><span className="search-hint">Search your workspace</span></div>
        {!ready ? <ResearchLoading label="Opening your workspace…" /> : filtered.length ? <ul className="project-list">{filtered.map((project, index) => <li key={project.id} className="project-row">
          <span className="row-number">{String(index + 1).padStart(2, "0")}</span><Link href={`/projects/${project.id}`} className="project-link"><h3>{project.title}<ArrowUpRight size={18} /></h3><p>{project.description || "An open question. A place to begin."}</p><time dateTime={project.updatedAt}>Updated {formatDate(project.updatedAt)}</time></Link>
          <div className="row-actions"><button className="icon-button" aria-label={`Rename ${project.title}`} onClick={() => setEditing(project)}><Pencil size={16} /></button><button className="icon-button delete-button" aria-label={`Delete ${project.title}`} onClick={() => { if (window.confirm(`Delete “${project.title}” and its notes? This cannot be undone.`)) remove(project.id); }}><Trash2 size={16} /></button></div>
        </li>)}</ul> : <div className="empty-state"><Sprout size={32} strokeWidth={1.2} className="empty-icon" /><h3>{search ? "No projects found." : "Every discovery starts with a question."}</h3><p>{search ? "Try a different name or a few other words." : "Give your next idea a place to grow."}</p>{!search && <button className="text-button accent mt-5" onClick={() => setEditing("new")}>Start your first project <ArrowRight size={16} /></button>}</div>}
        {projects.length > 0 && <div className="list-footer"><span>{`${projects.length} ${projects.length === 1 ? "idea" : "ideas"} in progress`}</span></div>}
      </section>
      <footer className="workspace-footer"><span className="footer-mark">✳</span><p>Stay curious. Follow the question.</p><span>VECTORHEART / V0.1</span></footer>
    </main>
    {editing && <ProjectDialog title={editing === "new" ? "A new beginning." : "A little refinement."} initialName={editing === "new" ? "" : editing.title} initialDescription={editing === "new" ? "" : editing.description} onClose={() => setEditing(null)} onSave={(title, description) => { if (editing === "new") { const id = create(title, description); if (id) router.push(`/projects/${id}/settings`); return !!id; } return update(editing.id, { title, description }); }} />}
  </div>;
}
