import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface ArchiveRow {
  id: string;
  userDisplayName: string;
  triggerType: string;
  state: string;
  isTest: boolean;
  duress: boolean;
  contactStatus: string;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  claimedBy: string | null;
  responders: Array<{ responderId: string; status: string; assignedAt: string | null; arrivedAt: string | null }>;
}
interface ArchiveResult { page: number; pageSize: number; total: number; pages: number; items: ArchiveRow[] }

export function ArchivePage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [state, setState] = useState("ALL");
  const [trigger, setTrigger] = useState("ALL");
  const [testMode, setTestMode] = useState("all");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: "25", state, trigger });
  if (submitted) params.set("query", submitted);
  if (testMode !== "all") params.set("isTest", String(testMode === "test"));
  const archive = useQuery({
    queryKey: ["archive", page, submitted, state, trigger, testMode],
    queryFn: () => api<ArchiveResult>(`/api/v1/admin/incidents/archive?${params.toString()}`, token),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSubmitted(query.trim());
  }
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-3xl font-semibold">Incident Archive</h1>
      <p className="mt-2 text-sm text-slate-300">Historical incidents, including resolved and TEST records. Filters run on the server.</p>
      <form onSubmit={submit} className="mt-5 grid gap-3 md:grid-cols-4">
        <label className="text-sm">Search
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2" placeholder="Name or incident ID" />
        </label>
        <label className="text-sm">State
          <select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2">
            {["ALL","PROTECTED","CONCERN","HIGH_RISK","SOS","ACKNOWLEDGED","RESPONDING","USER_LOCATED","RESOLVED","ARCHIVED"].map(v=><option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="text-sm">Trigger
          <select value={trigger} onChange={(e) => { setTrigger(e.target.value); setPage(1); }} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2">
            {["ALL","MANUAL_SOS","VOLUME_BUTTON","VOICE_SAFE_WORD","DURESS","JOURNEY_TIMEOUT","FALL_OR_IMPACT","SYSTEM_RISK_ESCALATION","WEARABLE"].map(v=><option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="text-sm">Environment
          <select value={testMode} onChange={(e) => { setTestMode(e.target.value); setPage(1); }} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2">
            <option value="all">Live + test</option><option value="live">Live only</option><option value="test">TEST only</option>
          </select>
        </label>
        <button className="rounded-lg border border-line px-3 py-2 text-sm md:col-span-4" type="submit">Apply search</button>
      </form>
      {archive.isError ? <p className="mt-4 text-sos">Archive could not be loaded.</p> : null}
      <div className="mt-5 overflow-x-auto rounded-2xl border border-line">
        <table className="min-w-full text-sm">
          <thead className="bg-panel text-left"><tr><th className="p-3">Person</th><th className="p-3">Trigger</th><th className="p-3">State</th><th className="p-3">Created</th><th className="p-3">Responder</th></tr></thead>
          <tbody>
            {(archive.data?.items ?? []).map(row=>(
              <tr key={row.id} className="border-t border-line">
                <td className="p-3"><Link className="underline" to={`/incidents/${row.id}`}>{row.userDisplayName}</Link>{row.isTest ? <span className="ml-2 rounded bg-warn px-2 py-1 text-xs text-ink">TEST</span>:null}{row.duress?<span className="ml-2 rounded bg-sos px-2 py-1 text-xs">DURESS</span>:null}</td>
                <td className="p-3">{row.triggerType}</td><td className="p-3">{row.state}</td><td className="p-3">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="p-3">{row.responders[0]?.status ?? "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <button className="rounded border border-line px-3 py-2 disabled:opacity-40" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button>
        <span>Page {archive.data?.page ?? page} of {archive.data?.pages ?? "—"} · {archive.data?.total ?? "—"} incidents</span>
        <button className="rounded border border-line px-3 py-2 disabled:opacity-40" disabled={Boolean(archive.data && page>=archive.data.pages)} onClick={()=>setPage(p=>p+1)}>Next</button>
      </div>
    </main>
  );
}
