import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Incident, type IncidentSummary } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge } from "./IncidentsPage";

export function DashboardPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const incidents = useQuery({
    queryKey: ["incidents"],
    queryFn: () => api<Incident[]>("/api/v1/incidents", token),
    refetchInterval: 5_000,
  });
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api<IncidentSummary>("/api/v1/incidents/summary", token),
    refetchInterval: 5_000,
  });
  const live = useMemo(
    () => (incidents.data ?? []).filter((row) => !["RESOLVED", "ARCHIVED"].includes(row.state) && !row.isTest),
    [incidents.data],
  );
  const unacked = live.filter((row) => row.state === "SOS" && !row.acknowledgedAt);
  const oldest = unacked[0];
  const ackWait = oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 1000)) : 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-300">Live monitoring. Test incidents stay out of these counts.</p>
        </div>
        <Link to="/incidents" className="rounded-lg border border-line px-3 py-2 text-sm">
          Full incident list
        </Link>
      </header>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active SOS" value={String(live.filter((row) => row.state === "SOS").length)} />
        <Metric label="Unacknowledged" value={summary.data ? String(summary.data.unacknowledgedIncidents) : "—"} />
        <Metric label="Duress" value={summary.data ? String(summary.data.duressAlerts) : "—"} />
        <Metric label="High risk" value={summary.data ? String(summary.data.highRiskAlerts) : "—"} />
        <Metric label="Contact lost" value={summary.data ? String(summary.data.devicesContactLost) : "—"} />
        <Metric label="Responders active" value={summary.data ? String(summary.data.respondersActive) : "—"} />
        <Metric label="Oldest unacked" value={oldest ? `${ackWait}s` : "none"} />
        <Metric label="Claimed open" value={String(live.filter((row) => row.claimedBy).length)} />
      </section>
      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="text-lg font-semibold">Live alerts</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {live.slice(0, 8).map((row) => (
              <li key={row.id}>
                <Link to={`/incidents/${row.id}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-semibold">{row.userDisplayName}</span>
                    <span className="block text-slate-300">
                      {row.triggerType} · {row.state} · {ageLabel(row.createdAt)}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {row.duress ? <Badge tone="sos">DURESS</Badge> : null}
                    {!row.acknowledgedAt ? <Badge tone="warn">UNACKED</Badge> : null}
                  </span>
                </Link>
              </li>
            ))}
            {live.length === 0 ? <li className="text-slate-300">No live incidents.</li> : null}
          </ul>
        </article>
        <article className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="text-lg font-semibold">Live map</h2>
          <p className="mt-2 text-sm text-slate-300">
            Open an incident for the last confirmed point. This dashboard does not guess a current track.
          </p>
          <p className="mt-4 text-sm">
            {oldest
              ? `Oldest unacknowledged SOS is ${oldest.userDisplayName}, waiting ${ackWait}s.`
              : "No acknowledgement SLA is running."}
          </p>
        </article>
      </section>
    </main>
  );
}

function ageLabel(createdAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </article>
  );
}
