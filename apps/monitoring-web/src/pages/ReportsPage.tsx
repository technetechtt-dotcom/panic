import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Report {
  windowDays: number;
  incidentCount: number;
  averageAcknowledgementSeconds: number | null;
  averageDispatchSeconds: number | null;
  averageResponderArrivalSeconds: number | null;
  guardianDeliverySuccessRate: number | null;
  guardianAcknowledgementRate: number | null;
  falseAlarmRate: number | null;
  falseAlarmNote: string;
  byTrigger: Record<string, number>;
  byState: Record<string, number>;
}
const duration=(seconds:number|null)=>seconds==null?"not measured":seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
export function ReportsPage(){
  const {session}=useAuth(); const token=session?.accessToken??null; const [days,setDays]=useState(30);
  const report=useQuery({queryKey:["reports",days],queryFn:()=>api<Report>(`/api/v1/admin/reports/overview?days=${days}`,token)});
  const r=report.data;
  return <main className="mx-auto max-w-6xl px-4 py-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-semibold">Reports</h1><p className="mt-2 text-sm text-slate-300">Measured operational results. TEST incidents are excluded.</p></div>
      <label className="text-sm">Window <select value={days} onChange={e=>setDays(Number(e.target.value))} className="ml-2 rounded-lg border border-line bg-ink px-3 py-2"><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option></select></label>
    </div>
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Metric label="Incidents" value={r?String(r.incidentCount):"—"}/><Metric label="Avg acknowledgement" value={r?duration(r.averageAcknowledgementSeconds):"—"}/><Metric label="Avg dispatch" value={r?duration(r.averageDispatchSeconds):"—"}/><Metric label="Avg responder arrival" value={r?duration(r.averageResponderArrivalSeconds):"—"}/><Metric label="Guardian delivery success" value={r?.guardianDeliverySuccessRate==null?"not measured":`${r.guardianDeliverySuccessRate}%`}/><Metric label="Guardian acknowledgement" value={r?.guardianAcknowledgementRate==null?"not measured":`${r.guardianAcknowledgementRate}%`}/>
    </section>
    <section className="mt-6 grid gap-4 lg:grid-cols-2"><Breakdown title="By trigger" rows={r?.byTrigger}/><Breakdown title="By state" rows={r?.byState}/></section>
    <p className="mt-6 rounded-xl border border-line bg-panel p-4 text-sm text-slate-300">{r?.falseAlarmNote ?? "False-alarm outcome is not inferred."}</p>
  </main>
}
function Metric({label,value}:{label:string;value:string}){return <article className="rounded-2xl border border-line bg-panel p-4"><p className="text-sm text-slate-300">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></article>}
function Breakdown({title,rows}:{title:string;rows?:Record<string,number>}){return <article className="rounded-2xl border border-line bg-panel p-4"><h2 className="text-lg font-semibold">{title}</h2><ul className="mt-3 space-y-2 text-sm">{Object.entries(rows??{}).map(([k,v])=><li key={k} className="flex justify-between"><span>{k}</span><strong>{v}</strong></li>)}</ul></article>}
