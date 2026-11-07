import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  correlationId: string | null;
  requestId: string | null;
  metadata?: Record<string, unknown> | null;
}
interface AuditResult { page:number; pageSize:number; total:number; pages:number; items:AuditRow[] }

export function AuditPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page:String(page), pageSize:"50" });
  if(submitted) params.set("query",submitted);
  if(action) params.set("action",action);
  if(actorId) params.set("actorId",actorId);
  if(entityType) params.set("entityType",entityType);
  if(entityId) params.set("entityId",entityId);
  if(from) params.set("from",new Date(from).toISOString());
  if(to) params.set("to",new Date(to).toISOString());

  const rows = useQuery({
    queryKey:["audit-search",page,submitted,action,actorId,entityType,entityId,from,to],
    queryFn:()=>api<AuditResult>(`/api/v1/audit/search?${params.toString()}`,token),
  });

  function submit(event:FormEvent){
    event.preventDefault();
    setPage(1);
    setSubmitted(query.trim());
  }

  const items=rows.data?.items??[];

  return (
    <main className="px-4 py-6">
      <h1 className="text-3xl font-semibold">Audit</h1>
      <p className="mt-2 text-sm text-slate-300">Server-side searchable audit records for operator, security and evidence-governance actions.</p>
      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm">Search
          <input value={query} onChange={(e)=>setQuery(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2" placeholder="Action, actor, incident, entity" />
        </label>
        <label className="text-sm">Exact action
          <input value={action} onChange={(e)=>{setAction(e.target.value);setPage(1)}} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2" placeholder="evidence.read" />
        </label>
        <label className="text-sm">Actor UUID
          <input value={actorId} onChange={(e)=>{setActorId(e.target.value);setPage(1)}} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2" />
        </label>
        <label className="text-sm">Entity type
          <input value={entityType} onChange={(e)=>{setEntityType(e.target.value);setPage(1)}} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2" placeholder="Incident" />
        </label>
        <label className="text-sm">Entity ID
          <input value={entityId} onChange={(e)=>{setEntityId(e.target.value);setPage(1)}} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2" />
        </label>
        <label className="text-sm">From
          <input type="datetime-local" value={from} onChange={(e)=>{setFrom(e.target.value);setPage(1)}} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2" />
        </label>
        <label className="text-sm">To
          <input type="datetime-local" value={to} onChange={(e)=>{setTo(e.target.value);setPage(1)}} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2" />
        </label>
        <button type="submit" className="self-end rounded-lg border border-line px-3 py-2 text-sm">Apply search</button>
      </form>
      <button
        type="button"
        className="mt-3 rounded-lg border border-line px-3 py-2 text-sm"
        onClick={()=>{
          const blob=new Blob([JSON.stringify(items,null,2)],{type:"application/json"});
          const url=URL.createObjectURL(blob);
          const link=document.createElement("a"); link.href=url; link.download=`guardian-audit-page-${page}.json`; link.click(); URL.revokeObjectURL(url);
        }}
      >
        Export current page
      </button>
      {rows.isError?<p className="mt-4 text-sos" role="alert">The audit log could not be loaded.</p>:null}
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {items.map((row)=>(
          <li key={row.id} className="px-4 py-3 text-sm">
            <p className="font-semibold">{row.action}</p>
            <p className="text-slate-300">{row.entityType} · {row.entityId}</p>
            <p className="text-xs text-slate-400">{new Date(row.createdAt).toLocaleString()} · actor {row.actorName??row.actorEmail??row.actorId??"system"}</p>
            {row.correlationId?<p className="text-xs text-slate-400">correlation {row.correlationId}</p>:null}
            {row.metadata?<pre className="mt-2 overflow-auto text-xs text-slate-400">{JSON.stringify(row.metadata,null,2)}</pre>:null}
          </li>
        ))}
        {items.length===0?<li className="px-4 py-8 text-slate-300">No audit rows match these filters.</li>:null}
      </ul>
      <div className="mt-4 flex items-center justify-between text-sm">
        <button className="rounded border border-line px-3 py-2 disabled:opacity-40" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button>
        <span>Page {rows.data?.page??page} of {rows.data?.pages??"—"} · {rows.data?.total??"—"} records</span>
        <button className="rounded border border-line px-3 py-2 disabled:opacity-40" disabled={Boolean(rows.data&&page>=rows.data.pages)} onClick={()=>setPage(p=>p+1)}>Next</button>
      </div>
    </main>
  );
}
