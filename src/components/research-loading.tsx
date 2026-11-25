import type { ReactNode } from "react";

/** Presentation only. The caller owns real request/run state. */
export function ResearchLoading({ active = true, label = "Preparing your research…", detail = "", children }: { active?: boolean; label?: string; detail?: string; children?: ReactNode }) {
  if (!active) return null;
  return <div className="vh-loading" role="status" aria-live="polite">
    <div className="vh-loading-content"><span className="vh-loading-fragments" aria-hidden="true"><i/><i/><i/><i/><i/><i/></span><div><strong>{label}</strong>{detail && <p>{detail}</p>}{children}</div></div>
  </div>;
}
