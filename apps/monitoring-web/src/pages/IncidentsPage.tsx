import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Incident, type IncidentSummary } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function IncidentsPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [query, setQuery] = useState("");
  const [state, setState] = useState("ALL");
  const [sort, setSort] = useState("newest");
  const incidents = useQuery({
    queryKey: ["incidents"],
    queryFn: () => api<Incident[]>("/api/v1/incidents", token),
    refetchInterval: 10_000,
  });
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api<IncidentSummary>("/api/v1/incidents/summary", token),
    refetchInterval: 10_000,
  });
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (incidents.data ?? [])
      .filter((row) => (state === "ALL" ? true : row.state === state))
      .filter((row) => {
        if (!needle) return true;
        return [row.userDisplayName, row.triggerType, row.state, row.contactStatus, row.id].join(" ").toLowerCase().includes(needle);
      })
      .sort((left, right) => {
        const leftAge = new Date(left.createdAt).getTime();
        const rightAge = new Date(right.createdAt).getTime();
        return sort === "oldest" ? leftAge - rightAge : rightAge - leftAge;
      });
  }, [incidents.data, query, sort, state]);
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-3xl font-semibold">Active incidents</h1>
      </header>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Active incidents" value={summary.data ? String(summary.data.activeIncidents) : "—"} />
        <Metric label="Unacknowledged" value={summary.data ? String(summary.data.unacknowledgedIncidents) : "—"} />
        <Metric label="Duress flags" value={summary.data ? String(summary.data.duressAlerts) : "—"} />
        <Metric label="Contact lost" value={summary.data ? String(summary.data.devicesContactLost) : "—"} />
        <Metric label="High risk" value={summary.data ? String(summary.data.highRiskAlerts) : "—"} />
        <Metric label="Responding" value={summary.data ? String(summary.data.respondersActive) : "—"} />
      </section>
      <p className="mt-3 text-sm text-slate-400">
        Counts exclude test incidents. High risk counts incidents in HIGH_RISK. Responding counts incidents a responder has been dispatched to.
        {session?.user.role === "RESPONDER" ? " This account sees assigned incidents only." : ""}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, trigger, or state"
          className="rounded-lg border border-line bg-ink px-3 py-2"
        />
        <select value={state} onChange={(event) => setState(event.target.value)} className="rounded-lg border border-line bg-ink px-3 py-2">
          {["ALL", "SOS", "ACKNOWLEDGED", "RESPONDING", "USER_LOCATED", "CONCERN", "HIGH_RISK"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-lg border border-line bg-ink px-3 py-2">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      {incidents.isError ? <p className="mt-6 text-sos">The incident list could not be loaded.</p> : null}
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {rows.map((incident) => (
          <li key={incident.id}>
            <Link to={`/incidents/${incident.id}`} className="flex flex-col gap-3 px-4 py-4 hover:bg-panel sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="block text-lg font-semibold">{incident.userDisplayName}</span>
                <span className="text-sm text-slate-300">
                  {incident.triggerType} · {incident.state} · {incident.contactStatus} · {ageLabel(incident.createdAt)}
                  {incident.claimedBy ? ` · claimed` : " · unclaimed"}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {incident.isTest ? <Badge tone="warn">TEST INCIDENT</Badge> : null}
                {incident.duress ? <Badge tone="sos">POSSIBLE FORCED CANCELLATION</Badge> : null}
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-4 py-8 text-slate-300">No incidents yet.</li> : null}
      </ul>
    </main>
  );
}

function ageLabel(createdAt: string | undefined): string {
  if (!createdAt) return "age unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s old`;
  return `${Math.floor(seconds / 60)}m old`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </article>
  );
}

export function Badge({ children, tone }: { children: string; tone: "warn" | "sos" }) {
  const color = tone === "warn" ? "bg-warn text-ink" : "bg-sos text-white";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${color}`}>{children}</span>;
}
