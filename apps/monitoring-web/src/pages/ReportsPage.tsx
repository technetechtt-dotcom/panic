import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface ResponderReport {
  responderId:string; displayName:string; region:string|null; assignments:number; completed:number; declined:number;
  completionRate:number|null; averageArrivalSeconds:number|null; arrivalP95Seconds:number|null;
}
interface Report {
  windowDays: number;
  incidentCount: number;
  averageAcknowledgementSeconds: number | null;
  averageDispatchSeconds: number | null;
  averageResponderArrivalSeconds: number | null;
  acknowledgementP50Seconds:number|null; acknowledgementP95Seconds:number|null;
  dispatchP50Seconds:number|null; dispatchP95Seconds:number|null;
  arrivalP50Seconds:number|null; arrivalP95Seconds:number|null;
  guardianDeliverySuccessRate: number | null;
  guardianAcknowledgementRate: number | null;
  falseAlarmRate: number | null;
  falseAlarmNote: string;
  byTrigger: Record<string, number>;
  byState: Record<string, number>;
  responders:ResponderReport[];
}
const duration=(seconds:number|null)=>seconds==null?"not measured":seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
export function ReportsPage(){
  const {session}=useAuth(); const token=session?.accessToken??null; const [days,setDays]=useState(30);
  const report=useQuery({queryKey:["reports",days],queryFn:()=>api<Report>(`/api/v1/admin/reports/overview?days=${days}`,token)});
  const r=report.data;
  function exportCsv(){
    if(!r) return;
    const rows=[
      ["metric","value"],
      ["window_days",String(r.windowDays)],
      ["incidents",String(r.incidentCount)],
      ["ack_avg_seconds",String(r.averageAcknowledgementSeconds??"")],
      ["ack_p50_seconds",String(r.acknowledgementP50Seconds??"")],
      ["ack_p95_seconds",String(r.acknowledgementP95Seconds??"")],
      ["dispatch_avg_seconds",String(r.averageDispatchSeconds??"")],
      ["dispatch_p50_seconds",String(r.dispatchP50Seconds??"")],
      ["dispatch_p95_seconds",String(r.dispatchP95Seconds??"")],
      ["arrival_avg_seconds",String(r.averageResponderArrivalSeconds??"")],
      ["arrival_p50_seconds",String(r.arrivalP50Seconds??"")],
      ["arrival_p95_seconds",String(r.arrivalP95Seconds??"")],
      ["guardian_delivery_success_percent",String(r.guardianDeliverySuccessRate??"")],
      ["guardian_ack_percent",String(r.guardianAcknowledgementRate??"")],
      ["false_alarm_percent",String(r.falseAlarmRate??"")],
      [],["responder","region","assignments","completed","declined","completion_rate","avg_arrival_seconds","p95_arrival_seconds"],
      ...r.responders.map(x=>[x.displayName,x.region??"",String(x.assignments),String(x.completed),String(x.declined),String(x.completionRate??""),String(x.averageArrivalSeconds??""),String(x.arrivalP95Seconds??"")])
    ];
    const csv=rows.map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(",")).join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a=document.createElement("a");a.href=url;a.download=`guardian-report-${days}d.csv`;a.click();URL.revokeObjectURL(url);
  }
  return <main className="mx-auto max-w-6xl px-4 py-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-semibold">Reports</h1><p className="mt-2 text-sm text-slate-300">Measured operational results. TEST incidents are excluded.</p></div>
      <div className="flex flex-wrap items-center gap-2"><label className="text-sm">Window <select value={days} onChange={e=>setDays(Number(e.target.value))} className="ml-2 rounded-lg border border-line bg-ink px-3 py-2"><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option></select></label>
      <button type="button" disabled={!r} onClick={exportCsv} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40">Export CSV</button>
      <button type="button" onClick={()=>window.print()} className="rounded-lg border border-line px-3 py-2 text-sm">Print / Save PDF</button></div>
    </div>
    {report.isLoading?<p className="mt-6 text-slate-300" role="status">Loading measured report data…</p>:null}
    {report.isError?<p className="mt-6 text-sos" role="alert">Reports could not be loaded. Metrics below are intentionally not inferred.</p>:null}
    {r&&r.incidentCount===0?<p className="mt-6 rounded-xl border border-line bg-panel p-4">No live incidents were recorded in this window.</p>:null}
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Metric label="Incidents" value={r?String(r.incidentCount):"—"}/><Metric label="Avg acknowledgement" value={r?duration(r.averageAcknowledgementSeconds):"—"}/><Metric label="Ack p50 / p95" value={r?`${duration(r.acknowledgementP50Seconds)} / ${duration(r.acknowledgementP95Seconds)}`:"—"}/>
      <Metric label="Avg dispatch" value={r?duration(r.averageDispatchSeconds):"—"}/><Metric label="Dispatch p50 / p95" value={r?`${duration(r.dispatchP50Seconds)} / ${duration(r.dispatchP95Seconds)}`:"—"}/><Metric label="Avg responder arrival" value={r?duration(r.averageResponderArrivalSeconds):"—"}/>
      <Metric label="Arrival p50 / p95" value={r?`${duration(r.arrivalP50Seconds)} / ${duration(r.arrivalP95Seconds)}`:"—"}/><Metric label="Guardian channel delivery success" value={r?.guardianDeliverySuccessRate==null?"not measured":`${r.guardianDeliverySuccessRate}%`}/><Metric label="Unique Guardian acknowledgement" value={r?.guardianAcknowledgementRate==null?"not measured":`${r.guardianAcknowledgementRate}%`}/><Metric label="False-alarm rate" value={r?.falseAlarmRate==null?"not measured":`${r.falseAlarmRate}%`}/>
    </section>
    <section className="mt-6 grid gap-4 lg:grid-cols-2"><Breakdown title="By trigger" rows={r?.byTrigger}/><Breakdown title="By outcome/state" rows={r?.byState}/></section>
    <section className="mt-6 overflow-x-auto rounded-2xl border border-line"><table className="min-w-full text-sm"><thead className="bg-panel text-left"><tr><th className="p-3">Responder</th><th className="p-3">Region</th><th className="p-3">Assigned</th><th className="p-3">Completed</th><th className="p-3">Declined</th><th className="p-3">Completion</th><th className="p-3">Arrival avg / p95</th></tr></thead><tbody>{(r?.responders??[]).map(x=><tr key={x.responderId} className="border-t border-line"><td className="p-3">{x.displayName}</td><td className="p-3">{x.region??"—"}</td><td className="p-3">{x.assignments}</td><td className="p-3">{x.completed}</td><td className="p-3">{x.declined}</td><td className="p-3">{x.completionRate==null?"—":`${x.completionRate}%`}</td><td className="p-3">{duration(x.averageArrivalSeconds)} / {duration(x.arrivalP95Seconds)}</td></tr>)}</tbody></table></section>
    <p className="mt-6 rounded-xl border border-line bg-panel p-4 text-sm text-slate-300">{r?.falseAlarmNote ?? "False-alarm outcome is not inferred."}</p>
  </main>
}
function Metric({label,value}:{label:string;value:string}){return <article className="rounded-2xl border border-line bg-panel p-4"><p className="text-sm text-slate-300">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></article>}
function Breakdown({title,rows}:{title:string;rows?:Record<string,number>}){return <article className="rounded-2xl border border-line bg-panel p-4"><h2 className="text-lg font-semibold">{title}</h2><ul className="mt-3 space-y-2 text-sm">{Object.entries(rows??{}).map(([k,v])=><li key={k} className="flex justify-between"><span>{k}</span><strong>{v}</strong></li>)}{Object.keys(rows??{}).length===0?<li className="text-slate-400">No data in this window.</li>:null}</ul></article>}
