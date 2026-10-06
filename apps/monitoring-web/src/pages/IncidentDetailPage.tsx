import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api, type Heartbeat, type Incident, type LocationPoint, type TimelineEntry } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge } from "./IncidentsPage";

const tileUrl = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION || "© OpenStreetMap contributors";

export function IncidentDetailPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [responderId, setResponderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const operator = session?.user.role !== "RESPONDER";

  const incident = useQuery({
    queryKey: ["incident", id],
    queryFn: () => api<Incident>(`/api/v1/incidents/${id}`, token),
  });
  const timeline = useQuery({
    queryKey: ["timeline", id],
    queryFn: () => api<TimelineEntry[]>(`/api/v1/incidents/${id}/timeline`, token),
  });
  const locations = useQuery({
    queryKey: ["locations", id],
    queryFn: () => api<LocationPoint[]>(`/api/v1/incidents/${id}/locations`, token),
  });
  const brief = useQuery({
    queryKey: ["brief", id],
    enabled: operator,
    queryFn: () => api<{ summary: string; checks: string[] }>(`/api/v1/incidents/${id}/brief`, token),
  });
  const corridor = useQuery({
    queryKey: ["corridor", id],
    enabled: operator,
    queryFn: () => api<{ radiusMeters: number; polygon: Array<{ latitude: number; longitude: number }> } | null>(`/api/v1/incidents/${id}/corridor`, token),
  });
  const evidence = useQuery({
    queryKey: ["evidence", id],
    enabled: operator,
    queryFn: () => api<Array<{ id: string; sequence: number; contentType: string; byteLength: number }>>(`/api/v1/incidents/${id}/evidence`, token),
  });
  const heartbeats = useQuery({
    queryKey: ["heartbeats", id],
    queryFn: () => api<Heartbeat[]>(`/api/v1/incidents/${id}/heartbeats`, token),
  });

  const deliveries = useQuery({
    queryKey: ["deliveries", id],
    enabled: operator,
    queryFn: () => api<Array<{ id: string; channel: string; status: string; detail: string; destination: string }>>(`/api/v1/incidents/${id}/deliveries`, token),
  });

  const action = useMutation({
    mutationFn: async (kind: "acknowledge" | "resolve") => {
      await api(`/api/v1/incidents/${id}/${kind}`, token, {
        method: "POST",
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
    },
    onSuccess: async () => {
      setError(null);
      setNote("");
      await queryClient.invalidateQueries();
    },
    onError: (caught: unknown) => setError(caught instanceof Error ? caught.message : "The action failed."),
  });

  const current = incident.data;
  const points = locations.data ?? [];
  const latestHeartbeat = heartbeats.data?.[0];
  const position = current?.lastLatitude != null && current.lastLongitude != null
    ? { lat: current.lastLatitude, lng: current.lastLongitude }
    : null;

  return (
    <main className="min-h-screen px-4 py-4">
      <Link to="/" className="text-sm text-slate-300">
        Back to incidents
      </Link>
      {current?.isTest ? (
        <p className="mt-3 rounded-xl bg-warn px-4 py-3 font-bold text-ink">TEST INCIDENT — excluded from live metrics</p>
      ) : null}
      {current?.duress ? (
        <p className="mt-3 rounded-xl bg-sos px-4 py-3 font-bold">POSSIBLE FORCED CANCELLATION</p>
      ) : null}
      {incident.isError ? <p className="mt-6 text-sos">This incident could not be loaded.</p> : null}
      {current ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr_320px]">
          <section className="rounded-2xl border border-line bg-panel p-4">
            <h1 className="text-2xl font-semibold">{current.userDisplayName}</h1>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Trigger" value={current.triggerType} />
              <Row label="State" value={current.state} />
              <Row label="Protection" value={current.protectionMode} />
              <Row label="Correlation" value={current.correlationId} />
              <Row label="App status" value={current.distressCapsule.appProtectionStatus} />
            </dl>
            {current.isTest ? <div className="mt-4"><Badge tone="warn">TEST INCIDENT</Badge></div> : null}
          </section>
          <section className="min-h-[420px] rounded-2xl border border-line bg-panel p-4">
            <h2 className="text-lg font-semibold">Last confirmed location</h2>
            <p className="mt-1 text-sm text-slate-300">
              {position
                ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · accuracy ${current.lastAccuracy ?? "unknown"} m`
                : "No confirmed location yet."}
            </p>
            <div className="mt-3 h-80 overflow-hidden rounded-xl">
              {position ? (
                <MapContainer center={[position.lat, position.lng]} zoom={15} scrollWheelZoom>
                  <TileLayer attribution={tileAttribution} url={tileUrl} />
                  <Polyline positions={points.map((point) => [point.latitude, point.longitude])} color="#f5c451" />
                  {corridor.data?.polygon?.length ? (
                    <Polygon positions={corridor.data.polygon.map((point) => [point.latitude, point.longitude])} pathOptions={{ color: "#7eb6ff" }} />
                  ) : null}
                  <CircleMarker center={[position.lat, position.lng]} radius={10} pathOptions={{ color: "#e23b3b" }} />
                </MapContainer>
              ) : (
                <div className="grid h-full place-items-center text-slate-400">Waiting for a location fix</div>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              The marker is the last confirmed device report. The blue shape is a search hint around that point, not a claim about where the person is.
              Replace the public tile server before production use.
            </p>
          </section>
          <section className="rounded-2xl border border-line bg-panel p-4">
            <h2 className="text-lg font-semibold">Timeline</h2>
            <ol className="mt-3 max-h-64 space-y-3 overflow-auto text-sm">
              {(timeline.data ?? []).map((entry) => (
                <li key={entry.id}>
                  <time className="block text-xs text-slate-400">{new Date(entry.occurredAt).toLocaleString()}</time>
                  {entry.message}
                </li>
              ))}
            </ol>
            {brief.data ? (
              <div className="mt-4 text-sm">
                <h2 className="text-lg font-semibold">Rules brief</h2>
                <p className="mt-2">{brief.data.summary}</p>
                <ul className="mt-2 list-disc pl-4 text-slate-300">
                  {brief.data.checks.map((check) => <li key={check}>{check}</li>)}
                </ul>
                <p className="mt-2 text-xs text-slate-400">This restates the incident. It cannot cancel, accuse, or dispatch.</p>
              </div>
            ) : null}
            <h2 className="mt-4 text-lg font-semibold">Guardian delivery</h2>
            <ul className="mt-2 text-sm">
              {(deliveries.data ?? []).map((item) => (
                <li key={item.id}>{item.channel} · {item.status} · {item.destination} · {item.detail}</li>
              ))}
              {deliveries.data?.length === 0 ? <li>No guardian message has been recorded for this incident.</li> : null}
            </ul>
            <h2 className="mt-4 text-lg font-semibold">Evidence</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {(evidence.data ?? []).map((item) => (
                <li key={item.id}>
                  {item.contentType} · {item.byteLength} bytes · part {item.sequence}
                  {item.contentType === "image/jpeg" ? (
                    <button
                      type="button"
                      className="ml-2 underline"
                      onClick={() => {
                        void api<{ contentType: string; bytesBase64: string }>(`/api/v1/incidents/${id}/evidence/${item.id}`, token)
                          .then((file) => setPreview(`data:${file.contentType};base64,${file.bytesBase64}`))
                          .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The photo could not be opened."));
                      }}
                    >
                      View photo
                    </button>
                  ) : null}
                </li>
              ))}
              {evidence.data?.length === 0 ? <li>No evidence stored for this incident.</li> : null}
            </ul>
            {preview ? <img src={preview} alt="Incident evidence" className="mt-3 max-h-64 rounded-lg" /> : null}
            {operator ? (
              <label className="mt-4 block text-sm" htmlFor="responder">
                Responder account id
                <input id="responder" value={responderId} onChange={(event) => setResponderId(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-ink p-2" />
              </label>
            ) : null}
            <h2 className="mt-4 text-lg font-semibold">Heartbeat</h2>
            <p className="mt-2 text-sm">
              {latestHeartbeat
                ? `${new Date(latestHeartbeat.recordedAt).toLocaleTimeString()} · battery ${latestHeartbeat.batteryLevel ?? "unknown"}% · ${latestHeartbeat.networkType}`
                : current.lastHeartbeatAt
                  ? `Last heartbeat ${new Date(current.lastHeartbeatAt).toLocaleTimeString()}`
                  : "No heartbeat yet."}
            </p>
            <p className="text-sm text-slate-300">Contact: {current.contactStatus}</p>
            <label className="mt-4 block text-sm" htmlFor="note">
              Operator note
              <textarea
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                className="mt-1 h-20 w-full rounded-lg border border-line bg-ink p-2"
              />
            </label>
            {error ? <p className="mt-2 text-sm text-sos">{error}</p> : null}
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                disabled={!operator || !["SOS", "CONCERN", "HIGH_RISK"].includes(current.state) || action.isPending}
                onClick={() => action.mutate("acknowledge")}
                className="rounded-lg bg-warn px-4 py-3 font-semibold text-ink disabled:opacity-40"
              >
                Acknowledge
              </button>
              <button
                type="button"
                disabled={!canResolve(current.state) || action.isPending}
                onClick={() => action.mutate("resolve")}
                className="rounded-lg bg-slate-100 px-4 py-3 font-semibold text-ink disabled:opacity-40"
              >
                Resolve
              </button>
              {operator ? (
                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() => {
                    void api(`/api/v1/incidents/${id}/emergency-services`, token, { method: "POST", body: JSON.stringify({}) })
                      .then(() => queryClient.invalidateQueries())
                      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The handoff was not recorded."));
                  }}
                  className="rounded-lg border border-line px-4 py-3 font-semibold"
                >
                  Record emergency-services handoff
                </button>
              ) : null}
              {operator ? (
                <button
                  type="button"
                  disabled={responderId.length < 30 || action.isPending}
                  onClick={() => {
                    void api(`/api/v1/incidents/${id}/responders`, token, {
                      method: "POST",
                      body: JSON.stringify({ responderId }),
                    }).then(() => queryClient.invalidateQueries()).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Dispatch failed."));
                  }}
                  className="rounded-lg border border-line px-4 py-3 font-semibold"
                >
                  Dispatch responder
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void api(`/api/v1/incidents/${id}/responder-status`, token, {
                      method: "POST",
                      body: JSON.stringify({ status: "USER_LOCATED" }),
                    }).then(() => queryClient.invalidateQueries()).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Update failed."));
                  }}
                  className="rounded-lg border border-line px-4 py-3 font-semibold"
                >
                  Report person located
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function canResolve(state: string): boolean {
  return ["SOS", "ACKNOWLEDGED", "RESPONDING", "USER_LOCATED", "CONCERN", "HIGH_RISK"].includes(state);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}
