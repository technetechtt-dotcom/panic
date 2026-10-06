import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Incident, type IncidentSummary } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useMonitorSocket } from "../api/socket";
import { Shell } from "../components/Shell";

export function IncidentsPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
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
  useMonitorSocket(token, () => {
    void incidents.refetch();
    void summary.refetch();
  });

  return (
    <Shell>
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-3xl font-semibold">Active incidents</h1>
      </header>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      {incidents.isError ? <p className="mt-6 text-sos">The incident list could not be loaded.</p> : null}
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {(incidents.data ?? []).map((incident) => (
          <li key={incident.id}>
            <Link to={`/incidents/${incident.id}`} className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-panel">
              <span>
                <span className="block text-lg font-semibold">{incident.userDisplayName}</span>
                <span className="text-sm text-slate-300">
                  {incident.triggerType} · {incident.state} · {incident.contactStatus}
                </span>
              </span>
              <span className="flex gap-2">
                {incident.isTest ? <Badge tone="warn">TEST INCIDENT</Badge> : null}
                {incident.duress ? <Badge tone="sos">POSSIBLE FORCED CANCELLATION</Badge> : null}
              </span>
            </Link>
          </li>
        ))}
        {incidents.data?.length === 0 ? <li className="px-4 py-8 text-slate-300">No incidents yet.</li> : null}
      </ul>
    </main>
    </Shell>
  );
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
