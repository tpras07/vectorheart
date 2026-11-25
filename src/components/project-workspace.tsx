"use client";

import { ResearchLoading } from "./research-loading";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { kernel } from "@/lib/kernel-repository";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Network, Settings2, GitBranch } from "lucide-react";
import { Brand } from "./brand";
import { AboutVectorHeart } from "./about-vectorheart";
import { useWorkspace } from "./workspace-provider";
import { ProjectNotebook } from "./project-notebook";
import { ProjectOverview } from "./project-overview";
import { ResearchEvolution } from "./research-evolution";
import { ResearchIntelligence } from "./research-intelligence";

const ResearchCanvas = dynamic(() => import("./research-canvas").then(module => module.ResearchCanvas), { ssr: false, loading: () => <ResearchLoading label="Opening your research canvas…" /> });
export type ProjectView = "settings" | "notebook" | "canvas" | "evolution";

export function ProjectWorkspace({ id, view }: { id: string; view?: ProjectView }) {
  const { projects, ready, update, pending, error, flush, sync } = useWorkspace();
  const project = projects.find(p => p.id === id);
  const router = useRouter();
  const [tracking,setTracking]=useState<{projectId:string;title:string}|null>(null);
  const hasProject=!!project;
  useEffect(()=>{
    if(!hasProject || view==="evolution")return;
    let cancelled=false;
    async function read(){try{const state=await kernel<{active_branch:string|null;open_branches:{id:string;title:string}[]}>(`projects/${id}/evolution/focus`);if(!cancelled)setTracking({projectId:id,title:state.open_branches.find(b=>b.id===state.active_branch)?.title??"Main research"});}catch{if(!cancelled)setTracking(null);}}
    void read();const timer=setInterval(()=>void read(),5000);return()=>{cancelled=true;clearInterval(timer);};
  },[id,view,hasProject]);
  function navigate(event:React.MouseEvent<HTMLAnchorElement>,target:string){
    if(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button!==0)return;
    event.preventDefault();void sync().then(()=>router.push(target)).catch(()=>{});
  }
  useEffect(() => () => { flush(); }, [id, view, flush]);
  useEffect(() => {
    if (!project) return;
    if (!view) router.replace(`/projects/${id}/${project.lastVisitedView ?? "settings"}`);
    else if ((view === "notebook" || view === "canvas") && project.lastVisitedView !== view) update(id, { lastVisitedView: view });
  }, [id, view, project, router, update]);

  return <div className={`project-shell ${view === "canvas" ? "project-shell-canvas" : ""}`}>
    <header className="project-header">
      <div className="project-topline"><div className="project-brand"><Link href="/" onClick={event => navigate(event,"/")} className="icon-button" aria-label="Back to projects"><ArrowLeft size={18} /></Link><Brand /></div>
        <div className="project-header-actions">{project && <Link href={`/projects/${id}/settings`} onClick={event => navigate(event,`/projects/${id}/settings`)} className={`icon-button project-settings-link ${view === "settings" ? "is-active" : ""}`} aria-label="Project settings" aria-current={view === "settings" ? "page" : undefined}><Settings2 size={19} /></Link>}
        <AboutVectorHeart /></div>
      </div>
      {project&&<ResearchIntelligence key={id} project={project}/>}
      {project && <><div className="project-identity"><h1>{project.title}</h1>{project.description && <p>{project.description}</p>}</div>
        <div className="project-navigation"><nav aria-label="Research views">{([['notebook', 'Notebook', BookOpen], ['canvas', 'Research Graph', Network], ['evolution', 'Research Evolution', GitBranch]] as const).map(([target, label, Icon]) => <Link key={target} href={`/projects/${id}/${target}`} onClick={event => navigate(event,`/projects/${id}/${target}`)} className={view === target ? "active-tab" : ""} aria-current={view === target ? "page" : undefined}><Icon size={16} strokeWidth={1.5} />{label}</Link>)}</nav>{view!=="evolution"&&<Link className="evolution-tracking-link" href={`/projects/${id}/evolution`} onClick={event=>navigate(event,`/projects/${id}/evolution`)} title="Open Research Evolution to switch tracking lanes"><GitBranch size={14}/> {tracking?.projectId===id?`Tracking: ${tracking.title}`:"Tracking lane"}</Link>}<span className="save-state" role="status">{error || pending ? "Unsaved changes" : "Saved locally"}</span></div></>}
    </header>
    {!ready ? <main className="project-content"><ResearchLoading label="Opening your workspace…" /></main> : !project ? <main className="project-content"><h1>That project isn’t here.</h1><p className="subtitle">It may have been deleted or created in another browser.</p><Link href="/" className="text-button mt-6"><ArrowLeft size={16} /> Back to your projects</Link></main> : !view ? <main className="project-content"><ResearchLoading label="Opening your workspace…" /></main> : view === "settings" ? <ProjectOverview key={id} project={project} /> : view === "notebook" ? <ProjectNotebook key={id} project={project} /> : view === "evolution" ? <ResearchEvolution key={id} project={project} /> : <ResearchCanvas key={id} project={project} />}
  </div>;
}
