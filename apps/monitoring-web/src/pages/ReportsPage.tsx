import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
interface Percentiles { p50: number | null; p90: number | null; p95: number | null; p99: number | null; samples: number }
interface Report {
  windowDays: number; incidentCount: number; possiblyTruncated: boolean;
  averageAcknowledgementSeconds: number | null; averageDispatchSeconds: number | null; averageResponderArrivalSeconds: number | null;
  guardianChannelDeliverySuccessRate: number | null; guardianDeliveryAcceptedRate: number | null; guardianAcknowledgementRate: number | null;
  guardianAcknowledgedUnique: number; guardianNotifiedUnique: number; falseAlarmRate: number | null; falseAlarmNote: string;
  byTrigger: Record<string, number>; byState: Record<string, number>; locationClusters: Record<string, number>; outcomes: Record<string, number>;
  sla: Record<string, Percentiles>;
  responderPerformance: Array<{ responderId: string; displayName: string; assigned: number; completed: number; declined: number; arrival: Percentiles }>;
}
const duration = (seconds: number | null) => seconds == null ? "not measured" : `${Math.round(seconds)}s`;
const rate = (value: number | null) => value == null ? "not measured" : `${value}%`;
function csvCell(value: unknown): string { const text = String(value ?? ""); return `"${(/^[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`; }
export function ReportsPage() {
  const { session } = useAuth(); const [days, setDays] = useState(30);
  const report = useQuery({ queryKey: ["reports", days], queryFn: () => api<Report>(`/api/v1/admin/reports/overview?days=${days}`, session?.accessToken ?? null) });
  const r = report.data;
  function exportCsv() {
    if (!r) return;
    const rows: unknown[][] = [["Section", "Metric", "Value"], ["Window", "Days", days], ["Window", "Possibly truncated", r.possiblyTruncated], ["Incidents", "Count", r.incidentCount], ["Guardians", "Channel delivered %", r.guardianChannelDeliverySuccessRate], ["Guardians", "Unique acknowledgement %", r.guardianAcknowledgementRate]];
    for (const [section, counts] of Object.entries({ triggers: r.byTrigger, states: r.byState, outcomes: r.outcomes, clusters: r.locationClusters })) for (const [key, value] of Object.entries(counts)) rows.push([section, key, value]);
    for (const [name, values] of Object.entries(r.sla)) for (const [key, value] of Object.entries(values)) rows.push(["SLA seconds", `${name} ${key}`, value]);
    for (const person of r.responderPerformance) { for (const key of ["assigned", "completed", "declined"] as const) rows.push([person.displayName, key, person[key]]); rows.push([person.displayName, "arrival p95 seconds", person.arrival.p95]); }
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `guardian-reports-${days}d.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <main className="mx-auto max-w-6xl px-4 py-6">
    <h1 className="text-3xl font-semibold">Reports</h1><p className="mt-2 text-slate-300">Measured operational results. TEST incidents are excluded.</p>
    <p className="mt-2 text-sm">Window: {days} days</p>
    <div className="mt-4 flex flex-wrap gap-3 print:hidden"><label>Window <select className="bg-ink p-2" value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map(value => <option key={value} value={value}>{value} days</option>)}</select></label><button disabled={!r} onClick={exportCsv}>Export CSV</button><button disabled={!r} onClick={() => window.print()}>Print / Save PDF</button></div>
    {report.isPending ? <p role="status" className="mt-6">Loading operational report…</p> : null}
    {report.isError ? <p role="alert" className="mt-6 text-sos">Report could not be loaded. <button onClick={() => void report.refetch()}>Retry</button></p> : null}
    {r ? <>
      {r.incidentCount === 0 ? <p className="mt-6">No live incidents were recorded in this window.</p> : null}
      {r.possiblyTruncated ? <p role="status" className="mt-4 text-warn">This report reached the 5,000 incident limit. Use a shorter window for complete results.</p> : null}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Incidents" value={String(r.incidentCount)} /><Metric label="Avg acknowledgement" value={duration(r.averageAcknowledgementSeconds)} /><Metric label="Avg dispatch" value={duration(r.averageDispatchSeconds)} /><Metric label="Avg responder arrival" value={duration(r.averageResponderArrivalSeconds)} /><Metric label="Guardian channel delivery confirmed" value={rate(r.guardianChannelDeliverySuccessRate)} /><Metric label="Guardian provider submissions accepted" value={rate(r.guardianDeliveryAcceptedRate)} /><Metric label="Unique Guardian acknowledgement" value={`${rate(r.guardianAcknowledgementRate)} (${r.guardianAcknowledgedUnique}/${r.guardianNotifiedUnique} incident/contact pairs)`} /><Metric label="False-alarm rate" value={rate(r.falseAlarmRate)} />
      </section>
      <p className="mt-3 text-sm text-slate-400">Delivery excludes skipped channels and private room links. Provider acceptance is separate from confirmed delivery and human acknowledgement.</p>
      <section className="mt-6 grid gap-3 lg:grid-cols-3">{Object.entries(r.sla ?? {}).map(([name, p]) => <article key={name} className="rounded-xl border border-line p-4"><h2>{name} SLA ({p.samples} samples)</h2><p>p50 {duration(p.p50)} · p90 {duration(p.p90)} · p95 {duration(p.p95)} · p99 {duration(p.p99)}</p></article>)}</section>
      <section className="mt-6 overflow-auto"><h2 className="text-xl">Responder performance</h2><table className="mt-3 w-full text-left text-sm"><thead><tr>{["Responder", "Assigned", "Completed", "Declined", "Arrival p95"].map(h => <th key={h} className="p-2" scope="col">{h}</th>)}</tr></thead><tbody>{(r.responderPerformance ?? []).map(person => <tr key={person.responderId}>{[person.displayName, person.assigned, person.completed, person.declined, duration(person.arrival.p95)].map((cell, i) => <td className="p-2" key={i}>{cell}</td>)}</tr>)}</tbody></table>{r.responderPerformance?.length === 0 ? <p>No responder assignments in this window.</p> : null}</section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2"><Breakdown title="By trigger" rows={r.byTrigger} /><Breakdown title="By state" rows={r.byState} /><Breakdown title="Outcomes" rows={r.outcomes} /><Breakdown title="Location clusters (0.1° cells)" rows={r.locationClusters} /></section>
      <p className="mt-6 text-sm text-slate-300">{r.falseAlarmNote}</p>
    </> : null}
  </main>;
}
function Metric({ label, value }: { label: string; value: string }) { return <article className="rounded-xl border border-line bg-panel p-4"><p>{label}</p><p className="mt-2 text-xl">{value}</p></article>; }
function Breakdown({ title, rows }: { title: string; rows: Record<string, number> }) { return <article className="rounded-xl border border-line bg-panel p-4"><h2>{title}</h2><ul className="mt-3 space-y-2">{Object.entries(rows ?? {}).map(([name, value]) => <li key={name} className="flex justify-between"><span>{name}</span><strong>{value}</strong></li>)}</ul></article>; }
