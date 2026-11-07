import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface DemoStatus {
  enabled: boolean;
  accounts: { protectedUser:string; guardian:string; responder:string };
  incidentId: string | null;
  state: string | null;
  stage: string | null;
}
const stages=[
  "SOS active on protected journey",
  "Route deviation + device contact lost",
  "Trusted Guardian acknowledges",
  "Responder Unit 04 dispatched / en route",
  "Protected person located",
  "Incident resolved",
];
export function DemoPage(){
  const {session}=useAuth(); const token=session?.accessToken??null; const qc=useQueryClient();
  const status=useQuery({queryKey:["demo-status"],queryFn:()=>api<DemoStatus>("/api/v1/admin/demo",token),retry:false});
  async function run(action:"reset"|"advance"){
    await api<DemoStatus>(`/api/v1/admin/demo/${action}`,token,{method:"POST",body:JSON.stringify({})});
    await Promise.all([qc.invalidateQueries({queryKey:["demo-status"]}),qc.invalidateQueries({queryKey:["incidents"]}),qc.invalidateQueries({queryKey:["summary"]}),qc.invalidateQueries({queryKey:["platform"]})]);
  }
  const row=status.data;
  const stageNumber=Number(row?.stage?.split(".").pop()??"0");
  return <main className="mx-auto max-w-5xl px-4 py-6">
    <div className="rounded-xl bg-warn px-4 py-3 font-bold text-ink">COMPETITION DEMO MODE — TEST DATA ONLY</div>
    <h1 className="mt-5 text-3xl font-semibold">Guardian competition scenario</h1>
    <p className="mt-2 text-sm text-slate-300">The scenario is deterministic, is always marked TEST, stays out of live metrics, and never sends real Guardian notifications.</p>
    {status.isError?<section className="mt-6 rounded-2xl border border-line bg-panel p-4"><h2 className="font-semibold">Demo mode is disabled</h2><p className="mt-2 text-sm text-slate-300">Set GUARDIAN_DEMO_MODE=true and a 12+ character GUARDIAN_DEMO_PASSWORD in the competition/staging environment. Keep it disabled in live production.</p></section>:null}
    {row?<>
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card label="Protected user" value={row.accounts.protectedUser}/><Card label="Guardian" value={row.accounts.guardian}/><Card label="Responder" value={row.accounts.responder}/>
      </section>
      <section className="mt-6 rounded-2xl border border-line bg-panel p-4">
        <h2 className="text-xl font-semibold">Scenario controls</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border border-line px-4 py-2" onClick={()=>void run("reset")}>Reset demo</button>
          <button type="button" disabled={!row.incidentId||stageNumber>=5} className="rounded-lg bg-warn px-4 py-2 font-semibold text-ink disabled:opacity-40" onClick={()=>void run("advance")}>Advance next stage</button>
          {row.incidentId?<Link className="rounded-lg border border-line px-4 py-2" to={`/incidents/${row.incidentId}`}>Open Incident Command</Link>:null}
        </div>
        <p className="mt-3 text-sm">Current: <strong>{row.state??"reset required"}</strong> · {row.stage??"no scenario yet"}</p>
      </section>
      <ol className="mt-6 space-y-3">
        {stages.map((text,index)=><li key={text} className={`rounded-xl border p-3 ${index<=stageNumber?"border-warn bg-panel":"border-line"}`}><strong>Stage {index}</strong> · {text}</li>)}
      </ol>
      <section className="mt-6 rounded-2xl border border-line bg-panel p-4 text-sm text-slate-300">
        <h2 className="text-lg font-semibold text-white">Presentation sequence</h2>
        <p className="mt-2">Reset → open Incident Command → advance each stage while showing Map, Intelligence, Guardians, Responders, Communications and Timeline. Because the incident is TEST, the demo cannot pollute live KPIs or contact real people.</p>
      </section>
    </>:null}
  </main>
}
function Card({label,value}:{label:string;value:string}){return <article className="rounded-2xl border border-line bg-panel p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 break-all font-semibold">{value}</p></article>}
