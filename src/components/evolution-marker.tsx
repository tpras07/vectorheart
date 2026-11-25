import type { MilestoneKind } from '@/lib/evolution-shapes';

export function EvolutionMarker({kind,x=0,y=0,color='#7040c2'}:{kind:MilestoneKind;x?:number;y?:number;color?:string}) {
  const fill={fill:color,stroke:'white',strokeWidth:1.5,strokeLinejoin:'round' as const};
  const line={fill:'none',stroke:color,strokeWidth:2,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  return <g className="evolution-marker" transform={`translate(${x} ${y})`} aria-hidden="true">
    {kind==='origin'&&<circle r={7} {...fill}/>}
    {kind==='checkpoint'&&<><rect x={-9} y={-9} width={18} height={18} rx={4} {...fill}/><path d="M-4 0 L-1 3 L5 -4" fill="none" stroke="white" strokeWidth={1.6} strokeLinecap="round"/></>}
    {kind==='exploration'&&<path d="M-9 0 L-4.5 -8 H4.5 L9 0 L4.5 8 H-4.5 Z" {...fill}/>}
    {kind==='hypothesis'&&<path d="M0 -10 L9 0 L0 10 L-9 0 Z" {...fill}/>}
    {kind==='experiment'&&<path d="M0 -10 L10 8 H-10 Z" {...fill}/>}
    {kind==='finding'&&<path d="M0 -11 L3 -3 L11 0 L3 3 L0 11 L-3 3 L-11 0 L-3 -3 Z" {...fill}/>}
    {kind==='journal'&&<><rect x={-7} y={-9} width={14} height={18} rx={2} {...fill}/><path d="M-3 -4 H3 M-3 0 H3 M-3 4 H1" stroke="white" strokeWidth={1.4} strokeLinecap="round"/></>}
    {kind==='observation'&&<circle r={7} fill="white" stroke={color} strokeWidth={2}/>}
    {kind==='evidence'&&<rect x={-10} y={-5.5} width={20} height={11} rx={5.5} {...fill}/>}
    {kind==='literature'&&<><path d="M-8 -8 H-1 L0 -6 L1 -8 H8 V7 H1 L0 9 L-1 7 H-8 Z" {...fill}/><path d="M0 -5 V6" stroke="white" strokeWidth={1.2}/></>}
    {kind==='proposal'&&<><path d="M0 -9 L8 -3 L5 8 H-5 L-8 -3 Z" {...fill}/><circle r={2} fill="white"/></>}
    {kind==='question'&&<><circle r={8} {...fill}/><text y={3.5} textAnchor="middle" fontSize={11} fontWeight="bold" fill="white">?</text></>}
    {kind==='relationship'&&<><rect x={-9} y={-4} width={12} height={8} rx={4} {...line}/><rect x={-3} y={-4} width={12} height={8} rx={4} {...line}/></>}
    {kind==='navigation'&&<path d="M-9 -4 H7 L3 -8 M7 -4 L3 0 M9 4 H-7 L-3 0 M-7 4 L-3 8" {...line}/>}
    {kind==='unsupported'&&<path d="M-6 -6 L6 6 M6 -6 L-6 6" {...line} strokeWidth={3}/>}
    {kind==='record'&&<rect x={-6} y={-6} width={12} height={12} rx={1} fill="white" stroke={color} strokeWidth={1.8}/>}
  </g>;
}
