import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface AiOperations {
  modelLifecycle:string;
  lifecycleNote:string;
  models:Array<{id:string;name:string;version:string;purpose:string;status:string;datasetNote:string;updatedAt:string}>;
  decisionsByLevel:Record<string,number>;
  decisionsByMode:Record<string,number>;
  recommendations:Record<string,number>;
  reviews:Record<string,number>;
  recent:Array<{id:string;incidentId:string;modelName:string;modelVersion:string;mode:string;level:string;confidence:number;createdAt:string}>;
}
export function AiOperationsPage(){
  const {session}=useAuth();
  const token=session?.accessToken??null;
  const data=useQuery({queryKey:["ai-operations"],queryFn:()=>api<AiOperations>("/api/v1/admin/ai/operations",token),refetchInterval:15000});
  const row=data.data;
  return <main className="mx-auto max-w-6xl px-4 py-6">
    <h1 className="text-3xl font-semibold">AI Operations</h1>
    <p className="mt-2 text-sm text-slate-300">Explainable Guardian Safety Intelligence. The current scorer is deterministic rules, not a trained model.</p>
    {row?<><section className="mt-5 rounded-2xl border border-line bg-panel p-4">
      <h2 className="text-lg font-semibold">Lifecycle control</h2>
      <p className="mt-2 text-sm">{row.modelLifecycle.replace(/_/g," ")}</p>
      <p className="mt-1 text-sm text-slate-300">{row.lifecycleNote}</p>
    </section>
    <section className="mt-5 grid gap-4 lg:grid-cols-2">
      {row.models.map(model=><article key={model.id} className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{model.name} {model.version}</h2><span className="rounded border border-line px-2 py-1 text-xs">{model.status}</span></div>
        <p className="mt-2 text-sm">{model.purpose}</p><p className="mt-2 text-xs text-slate-400">{model.datasetNote}</p>
      </article>)}
    </section>
    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric title="Production decisions" values={row.decisionsByMode}/>
      <Metric title="Threat levels" values={row.decisionsByLevel}/>
      <Metric title="Recommendations" values={row.recommendations}/>
      <Metric title="Human reviews" values={row.reviews}/>
    </section>
    <section className="mt-5 rounded-2xl border border-line bg-panel p-4">
      <h2 className="text-lg font-semibold">Recent decisions</h2>
      <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-slate-400"><th className="p-2">Time</th><th className="p-2">Incident</th><th className="p-2">Mode</th><th className="p-2">Level</th><th className="p-2">Confidence</th></tr></thead><tbody>
      {row.recent.map(item=><tr key={item.id} className="border-t border-line"><td className="p-2">{new Date(item.createdAt).toLocaleString()}</td><td className="p-2"><Link className="underline" to={`/incidents/${item.incidentId}`}>{item.incidentId.slice(0,8)}…</Link></td><td className="p-2">{item.mode}</td><td className="p-2">{item.level}</td><td className="p-2">{Math.round(item.confidence*100)}%</td></tr>)}
      </tbody></table></div>
    </section></>:null}
    {data.isError?<p className="mt-5 text-sos" role="alert">AI operations could not be loaded.</p>:null}
  </main>
}
function Metric({title,values}:{title:string;values:Record<string,number>}){return <article className="rounded-2xl border border-line bg-panel p-4"><h2 className="text-sm font-semibold">{title}</h2><ul className="mt-2 space-y-1 text-xs text-slate-300">{Object.entries(values).map(([k,v])=><li key={k} className="flex justify-between gap-3"><span>{k}</span><strong>{v}</strong></li>)}{Object.keys(values).length===0?<li>None recorded</li>:null}</ul></article>}
