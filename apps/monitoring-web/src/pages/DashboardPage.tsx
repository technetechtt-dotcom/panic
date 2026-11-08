import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api, type Incident, type IncidentSummary } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ResponderDashboardPage } from "./ResponderDashboardPage";
import { Badge } from "./IncidentsPage";

const tileUrl = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION || "© OpenStreetMap contributors";
interface LiveResponder { id:string; displayName:string; status:string; latitude:number|null; longitude:number|null; locationAt:string|null; activeIncidentId:string|null; assignmentStatus:string|null; workload:number }

export function DashboardPage() {
  const { session } = useAuth();
  return session?.user.role === "RESPONDER" ? <ResponderDashboardPage /> : <OperatorDashboardPage />;
}

function OperatorDashboardPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const isResponder = session?.user.role === "RESPONDER";
  const incidents = useQuery({
    queryKey: ["incidents"],
    queryFn: () => api<Incident[]>("/api/v1/incidents", token),
    refetchInterval: 5_000,
  });
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api<IncidentSummary>("/api/v1/incidents/summary", token),
    enabled: !isResponder,
    refetchInterval: 5_000,
  });
  const responders = useQuery({
    queryKey: ["responders-live"],
    queryFn: () => api<LiveResponder[]>("/api/v1/responders", token),
    enabled: !isResponder,
    refetchInterval: 5_000,
  });
  const live = useMemo(
    () => (incidents.data ?? []).filter((row) => !["RESOLVED", "FALSE_ALARM", "ARCHIVED"].includes(row.state) && !row.isTest),
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
          <h2 className="text-lg font-semibold">Shift</h2>
          <p className="mt-2 text-sm text-slate-300">Manage readiness and hand over to a receiving operator from the Shift page.</p>
          <Link to="/shift" className="mt-3 inline-block rounded-lg border border-line px-3 py-2">Open Shift</Link>
        </article>
        <article className="rounded-2xl border border-line bg-panel p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-lg font-semibold">Live operations map</h2><p className="mt-1 text-xs text-slate-400">Markers are last confirmed reports, not inferred current positions.</p></div>
            <span className="text-xs text-slate-300">{live.filter(row=>row.lastLatitude!=null && row.lastLongitude!=null).length} incidents · {(responders.data??[]).filter(row=>row.latitude!=null && row.longitude!=null).length} responders located</span>
          </div>
          <div className="mt-3 h-[28rem] overflow-hidden rounded-xl">
            <MapContainer
              center={(live.find(row=>row.lastLatitude!=null && row.lastLongitude!=null)
                ? [live.find(row=>row.lastLatitude!=null && row.lastLongitude!=null)!.lastLatitude!, live.find(row=>row.lastLatitude!=null && row.lastLongitude!=null)!.lastLongitude!]
                : [-30.5595, 22.9375]) as [number, number]}
              zoom={live.some(row=>row.lastLatitude!=null) ? 11 : 5}
              scrollWheelZoom
              className="h-full w-full"
            >
              <TileLayer attribution={tileAttribution} url={tileUrl} />
              {live.filter(row=>row.lastLatitude!=null && row.lastLongitude!=null).map(row=>(
                <CircleMarker key={row.id} center={[row.lastLatitude!,row.lastLongitude!]} radius={row.state==="SOS"?10:8} pathOptions={{ color: row.state==="SOS"?"#e23b3b":row.state==="HIGH_RISK"?"#f59e0b":"#f5c451" }}>
                  <Popup><strong>{row.userDisplayName}</strong><br/>{row.state} · {row.contactStatus}<br/><Link to={`/incidents/${row.id}`}>Open incident</Link></Popup>
                </CircleMarker>
              ))}
              {(responders.data??[]).filter(row=>row.latitude!=null && row.longitude!=null).map(row=>(
                <CircleMarker key={`responder-${row.id}`} center={[row.latitude!,row.longitude!]} radius={7} pathOptions={{ color:"#7eb6ff" }}>
                  <Popup><strong>{row.displayName}</strong><br/>{row.assignmentStatus??row.status} · workload {row.workload}{row.activeIncidentId?<><br/><Link to={`/incidents/${row.activeIncidentId}`}>Open assignment</Link></>:null}</Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <p className="mt-3 text-sm">{oldest ? `Oldest unacknowledged SOS is ${oldest.userDisplayName}, waiting ${ackWait}s.` : "No acknowledgement SLA is running."}</p>
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
