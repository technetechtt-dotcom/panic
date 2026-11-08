import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api, apiBlob, type Heartbeat, type Incident, type LocationPoint, type TimelineEntry } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge } from "./IncidentsPage";
import { AiPanel } from "./AiPanel";

const tileUrl = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION || "© OpenStreetMap contributors";

interface EmergencyProfile {
  bloodType: string | null;
  allergies: string | null;
  medications: string | null;
  notes: string | null;
}
interface CommunicationEntry {
  id: string;
  at: string;
  kind: string;
  channel: string;
  message: string;
  status: string | null;
}
interface SearchArea {
  id: string;
  kind: string;
  label: string;
  confidence: number;
  polygon: Array<{ latitude: number; longitude: number }>;
}

export function IncidentDetailPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [responderId, setResponderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [media, setMedia] = useState<{ url: string; type: string } | null>(null);
  const [tab, setTab] = useState("overview");
  const [retentionDays, setRetentionDays] = useState("365");
  const [legalHold, setLegalHold] = useState(false);
  const [retentionPolicy, setRetentionPolicy] = useState("STANDARD");
  const operator = session?.user.role !== "RESPONDER";
  const responder = session?.user.role === "RESPONDER";
  const canManageEvidence = session?.user.role === "ADMIN" || session?.user.role === "SUPERVISOR";

  const incident = useQuery({
    queryKey: ["incident", id],
    queryFn: () => api<Incident>(`/api/v1/incidents/${id}`, token),
    refetchInterval: 4_000,
  });
  const timeline = useQuery({
    queryKey: ["timeline", id],
    queryFn: () => api<TimelineEntry[]>(`/api/v1/incidents/${id}/timeline`, token),
    refetchInterval: 4_000,
  });
  const locations = useQuery({
    queryKey: ["locations", id],
    queryFn: () => api<LocationPoint[]>(`/api/v1/incidents/${id}/locations`, token),
    refetchInterval: 4_000,
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
    queryKey: ["evidence-artifacts", id],
    enabled: operator,
    queryFn: () => api<Array<{
      id: string;
      clientCaptureId: string;
      contentType: string;
      originalByteLength: number;
      originalSha256: string;
      capturedAt: string;
      chunkCount: number;
      receivedChunks: number;
      status: string;
      completedAt: string | null;
      retentionUntil: string | null;
      legalHold: boolean;
      retentionPolicy: string;
    }>>(`/api/v1/incidents/${id}/evidence-artifacts`, token),
  });
  const responders = useQuery({
    queryKey: ["responders"],
    enabled: operator,
    queryFn: () => api<Array<{ id: string; displayName: string; email: string; status: string; team?: string | null; region?: string | null; capabilities?: string | null }>>("/api/v1/responders", token),
  });
  const heartbeats = useQuery({
    queryKey: ["heartbeats", id],
    queryFn: () => api<Heartbeat[]>(`/api/v1/incidents/${id}/heartbeats`, token),
    refetchInterval: 4_000,
  });

  const deliveries = useQuery({
    queryKey: ["deliveries", id],
    enabled: operator,
    queryFn: () => api<Array<{ id: string; channel: string; status: string; detail: string; destination: string; providerMessageId?: string; attemptNumber?: number; sentAt?: string; deliveredAt?: string; failedAt?: string; failureCode?: string }>>(`/api/v1/incidents/${id}/deliveries`, token),
  });

  const emergencyProfile = useQuery({
    queryKey: ["emergency-profile", id],
    queryFn: () => api<EmergencyProfile>(`/api/v1/incidents/${id}/emergency-profile`, token),
  });
  const communications = useQuery({
    queryKey: ["communications", id],
    queryFn: () => api<CommunicationEntry[]>(`/api/v1/incidents/${id}/communications`, token),
    refetchInterval: 4_000,
  });
  const liveCompanion = useQuery({
    queryKey: ["live-companion", id],
    queryFn: () => api<{ responders: Array<{ responderId: string; status: string }> }>(`/api/v1/incidents/${id}/live`, token),
    enabled: responder,
    refetchInterval: 4_000,
  });
  const responderStatus = liveCompanion.data?.responders?.find((row) => row.responderId === session?.user.id)?.status ?? "ASSIGNED";

  const aiSearch = useQuery({
    queryKey: ["ai-search", id],
    enabled: operator,
    queryFn: () => api<SearchArea[]>(`/api/v1/incidents/${id}/ai/search`, token),
    refetchInterval: 15_000,
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

  async function downloadEvidenceManifest() {
    setError(null);
    try {
      const manifest = await api<Record<string, unknown>>(`/api/v1/incidents/${id}/evidence-manifest`, token);
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `guardian-evidence-${id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The evidence manifest could not be exported.");
    }
  }

  async function saveEvidenceGovernance() {
    setError(null);
    try {
      await api(`/api/v1/admin/incidents/${id}/evidence/governance`, token, {
        method: "POST",
        body: JSON.stringify({
          retentionDays: Number(retentionDays),
          legalHold,
          policy: retentionPolicy.trim() || "STANDARD",
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["evidence-artifacts", id] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evidence governance could not be updated.");
    }
  }

  const current = incident.data;
  const points = locations.data ?? [];
  const latestHeartbeat = heartbeats.data?.[0];
  const position = current?.lastLatitude != null && current.lastLongitude != null
    ? { lat: current.lastLatitude, lng: current.lastLongitude }
    : null;

  return (
    <main className="min-h-screen px-4 py-4">
      <Link to="/incidents" className="text-sm text-slate-300">
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
        <>
        <nav
          className="mt-4 flex flex-wrap gap-2"
          aria-label="Incident sections"
          role="tablist"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
            const currentIndex = tabs.findIndex((item) => item === document.activeElement);
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight"
              ? (currentIndex + 1 + tabs.length) % tabs.length
              : (currentIndex - 1 + tabs.length) % tabs.length;
            event.preventDefault();
            tabs[nextIndex]?.focus();
            tabs[nextIndex]?.click();
          }}
        >
          {(responder
            ? ["overview", "map", "responders", "timeline", "communications", "profile", "intelligence"]
            : ["overview", "map", "evidence", "guardians", "responders", "timeline", "communications", "profile", "intelligence"]
          ).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              aria-controls={`incident-panel-${name}`}
              id={`incident-tab-${name}`}
              onClick={() => setTab(name)}
              className={`rounded-lg px-3 py-2 text-sm ${tab === name ? "bg-ink text-white" : "border border-line"}`}
            >
              {name}
            </button>
          ))}
        </nav>
        {tab === "intelligence" ? (
          <div id="incident-panel-intelligence" role="tabpanel" aria-labelledby="incident-tab-intelligence">
            <AiPanel id={id} token={token} canDecide={operator} />
          </div>
        ) : null}
        {tab === "communications" ? (
          <section id="incident-panel-communications" role="tabpanel" aria-labelledby="incident-tab-communications" className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <h2 className="text-xl font-semibold">Communications</h2>
            <p className="mt-1 text-sm text-slate-400">Ordered delivery, operator, responder and emergency-service events.</p>
            <ol className="mt-4 space-y-3 text-sm">
              {(communications.data ?? []).map(entry => <li key={entry.id} className="border-l-2 border-line pl-3">
                <time className="block text-xs text-slate-400">{new Date(entry.at).toLocaleString()}</time>
                <strong>{entry.channel}</strong> · {entry.kind}{entry.status ? ` · ${entry.status}` : ""}
                <p className="text-slate-300">{entry.message}</p>
              </li>)}
              {communications.data?.length === 0 ? <li>No communications recorded yet.</li> : null}
            </ol>
          </section>
        ) : null}
        {tab === "profile" ? (
          <section id="incident-panel-profile" role="tabpanel" aria-labelledby="incident-tab-profile" className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <h2 className="text-xl font-semibold">Emergency profile</h2>
            <p className="mt-1 text-sm text-slate-400">Authorised incident information only.</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Row label="Blood type" value={emergencyProfile.data?.bloodType ?? "not recorded"} />
              <Row label="Allergies" value={emergencyProfile.data?.allergies ?? "not recorded"} />
              <Row label="Medications" value={emergencyProfile.data?.medications ?? "not recorded"} />
              <Row label="Notes" value={emergencyProfile.data?.notes ?? "not recorded"} />
            </dl>
          </section>
        ) : null}
        {!["intelligence","communications","profile"].includes(tab) ? (
        <div id={`incident-panel-${tab}`} role="tabpanel" aria-labelledby={`incident-tab-${tab}`} className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr_320px]">
          <section className={`rounded-2xl border border-line bg-panel p-4 ${tab === "overview" || tab === "responders" ? "" : "lg:block hidden"}`}>
            <h1 className="text-2xl font-semibold">{current.userDisplayName}</h1>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Trigger" value={current.triggerType} />
              <Row label="State" value={current.state} />
              <Row label="Protection" value={current.protectionMode} />
              <Row label="Correlation" value={current.correlationId} />
              <Row label="App status" value={current.distressCapsule.appProtectionStatus} />
            </dl>
            {current.isTest ? <div className="mt-4"><Badge tone="warn">TEST INCIDENT</Badge></div> : null}
            {current.claimedBy ? <p className="mt-3 text-sm">Claimed by operator {current.claimedBy.slice(0, 8)}…</p> : <p className="mt-3 text-sm">Unclaimed.</p>}
            {current.escalatedToSupervisorAt ? <p className="mt-2 text-sm text-warn">Escalated to supervisor at {new Date(current.escalatedToSupervisorAt).toLocaleTimeString()}.</p> : null}
          </section>
          <section className={`min-h-[50vh] rounded-2xl border border-line bg-panel p-4 ${tab === "map" || tab === "overview" ? "" : "hidden"}`}>
            <h2 className="text-lg font-semibold">Last confirmed location</h2>
            <p className="mt-1 text-sm text-slate-300">
              {position
                ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · accuracy ${current.lastAccuracy ?? "unknown"} m`
                : "No confirmed location yet."}
            </p>
            <div className="mt-3 h-[min(28rem,60vh)] overflow-hidden rounded-xl">
              {position ? (
                <MapContainer center={[position.lat, position.lng]} zoom={15} scrollWheelZoom>
                  <TileLayer attribution={tileAttribution} url={tileUrl} />
                  <Polyline positions={points.map((point) => [point.latitude, point.longitude])} color="#f5c451" />
                  {corridor.data?.polygon?.length ? (
                    <Polygon positions={corridor.data.polygon.map((point) => [point.latitude, point.longitude])} pathOptions={{ color: "#7eb6ff" }} />
                  ) : null}
                  {(aiSearch.data ?? []).filter(area => Array.isArray(area.polygon) && area.polygon.length >= 3).map(area => (
                    <Polygon
                      key={area.id}
                      positions={area.polygon.map(point => [point.latitude, point.longitude])}
                      pathOptions={{ color: "#c084fc", dashArray: "6 6", fillOpacity: Math.max(0.08, Math.min(0.28, area.confidence * 0.25)) }}
                    />
                  ))}
                  <CircleMarker center={[position.lat, position.lng]} radius={10} pathOptions={{ color: "#e23b3b" }} />
                </MapContainer>
              ) : (
                <div className="grid h-full place-items-center text-slate-400">Waiting for a location fix</div>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              The red marker is the last confirmed device report. Blue is the deterministic search corridor. Dashed purple areas are AI search predictions and are never confirmed locations.
              Replace the public tile server before production use.
            </p>
          </section>
          <section className="sticky bottom-0 rounded-2xl border border-line bg-panel p-4 lg:static">
            <h2 className={`text-lg font-semibold ${tab === "timeline" || tab === "overview" ? "" : "hidden"}`}>Timeline</h2>
            <ol className={`mt-3 max-h-64 space-y-3 overflow-auto text-sm ${tab === "timeline" || tab === "overview" ? "" : "hidden"}`}>
              {(timeline.data ?? []).map((entry) => (
                <li key={entry.id}>
                  <time className="block text-xs text-slate-400">{new Date(entry.occurredAt).toLocaleString()}</time>
                  {entry.message}
                </li>
              ))}
            </ol>
            {brief.data ? (
              <div className={`mt-4 text-sm ${tab === "timeline" || tab === "overview" ? "" : "hidden"}`}>
                <h2 className="text-lg font-semibold">Rules brief</h2>
                <p className="mt-2">{brief.data.summary}</p>
                <ul className="mt-2 list-disc pl-4 text-slate-300">
                  {brief.data.checks.map((check) => <li key={check}>{check}</li>)}
                </ul>
                <p className="mt-2 text-xs text-slate-400">This restates the incident. It cannot cancel, accuse, or dispatch.</p>
              </div>
            ) : null}
            {operator ? <h2 className={`mt-4 text-lg font-semibold ${tab === "guardians" || tab === "overview" ? "" : "hidden"}`}>Guardian delivery</h2> : null}
            {operator ? <ul className={`mt-2 text-sm ${tab === "guardians" || tab === "overview" ? "" : "hidden"}`}>
              {(deliveries.data ?? []).map((item) => (
                <li key={item.id}>
                  {item.channel} · {item.status} · {item.destination} · attempt {item.attemptNumber ?? 1}
                  {item.sentAt ? ` · sent ${new Date(item.sentAt).toLocaleTimeString()}` : " · provider submission"}
                  {item.deliveredAt ? ` · delivered ${new Date(item.deliveredAt).toLocaleTimeString()}` : ""}
                  {item.failureCode ? ` · ${item.failureCode}` : ""}
                  · {item.detail}
                </li>
              ))}
              {deliveries.data?.length === 0 ? <li>No guardian message has been recorded for this incident.</li> : null}
            </ul> : null}
            {operator ? <h2 className={`mt-4 text-lg font-semibold ${tab === "evidence" || tab === "overview" ? "" : "hidden"}`}>Evidence</h2> : null}
            {operator ? <ul className={`mt-2 space-y-2 text-sm ${tab === "evidence" || tab === "overview" ? "" : "hidden"}`}>
              {(evidence.data ?? []).map((item) => (
                <li key={item.id} className="rounded-lg border border-line p-2">
                  <strong>{item.contentType}</strong> · {item.originalByteLength} bytes · {item.receivedChunks}/{item.chunkCount} chunks · {item.status}
                  <span className="block text-xs text-slate-400">
                    captured {new Date(item.capturedAt).toLocaleString()} · original sha256 {item.originalSha256.slice(0, 16)}…
                    {item.legalHold ? " · LEGAL HOLD" : ` · retention ${item.retentionPolicy}`}
                  </span>
                  <button
                    type="button"
                    disabled={item.status !== "COMPLETE"}
                    className="mt-1 underline disabled:opacity-40"
                    onClick={() => {
                      void apiBlob(`/api/v1/incidents/${id}/evidence-artifacts/${encodeURIComponent(item.id)}/content`, token)
                        .then((blob) => {
                          const url = URL.createObjectURL(blob);
                          if (item.contentType.startsWith("image/")) {
                            if (media?.url) URL.revokeObjectURL(media.url);
                            setPreview(url);
                            setMedia(null);
                            return;
                          }
                          if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
                          if (media?.url) URL.revokeObjectURL(media.url);
                          setMedia({ url, type: item.contentType });
                          setPreview(null);
                        })
                        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The evidence artifact could not be opened."));
                    }}
                  >
                    Open verified capture
                  </button>
                </li>
              ))}
              {evidence.data?.length === 0 ? <li>No evidence stored for this incident.</li> : null}
            </ul> : null}
            {operator ? <div className={`mt-3 space-y-2 ${tab === "evidence" || tab === "overview" ? "" : "hidden"}`}>
              <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => void downloadEvidenceManifest()}>
                Export chain-of-custody manifest
              </button>
              {canManageEvidence ? (
                <div className="rounded-xl border border-line p-3 text-sm">
                  <h3 className="font-semibold">Evidence governance</h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label>
                      Retention days
                      <input
                        type="number"
                        min={1}
                        max={3650}
                        value={retentionDays}
                        disabled={legalHold}
                        onChange={(event) => setRetentionDays(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-line bg-ink px-2 py-2"
                      />
                    </label>
                    <label>
                      Policy
                      <input
                        value={retentionPolicy}
                        maxLength={40}
                        onChange={(event) => setRetentionPolicy(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-line bg-ink px-2 py-2"
                      />
                    </label>
                    <label className="flex items-end gap-2 pb-2">
                      <input type="checkbox" checked={legalHold} onChange={(event) => setLegalHold(event.target.checked)} />
                      Legal hold
                    </label>
                  </div>
                  <button type="button" className="mt-2 rounded-lg border border-line px-3 py-2" onClick={() => void saveEvidenceGovernance()}>
                    Save retention / hold
                  </button>
                  <p className="mt-2 text-xs text-slate-400">A legal hold clears automatic expiry. Changes are written to the audit log.</p>
                </div>
              ) : null}
            </div> : null}
            {operator && preview ? <img src={preview} alt="Incident evidence" className="mt-3 max-h-64 rounded-lg" /> : null}
            {operator && media?.type.startsWith("audio/") ? <audio className="mt-3 w-full" controls src={media.url} /> : null}
            {operator && media?.type.startsWith("video/") ? <video className="mt-3 max-h-64 w-full" controls src={media.url} /> : null}
            {operator ? (
              <label className="mt-4 block text-sm" htmlFor="responder">
                Responder
                <select
                  id="responder"
                  value={responderId}
                  onChange={(event) => setResponderId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-ink p-2"
                >
                  <option value="">Select a responder</option>
                  {(responders.data ?? []).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.displayName} · {row.status} · {row.team ?? "no team"} · {row.region ?? "no region"}
                    </option>
                  ))}
                </select>
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
              {operator ? (
                <button
                  type="button"
                  disabled={Boolean(current.claimedBy) || action.isPending}
                  onClick={() => {
                    void api(`/api/v1/incidents/${id}/claim`, token, { method: "POST", body: JSON.stringify({}) })
                      .then(() => queryClient.invalidateQueries())
                      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Claim failed."));
                  }}
                  className="rounded-lg bg-sos px-4 py-3 font-semibold disabled:opacity-40"
                >
                  Claim this incident
                </button>
              ) : null}
              {operator ? (
                <button
                  type="button"
                  disabled={!["SOS", "CONCERN", "HIGH_RISK"].includes(current.state) || action.isPending}
                  onClick={() => action.mutate("acknowledge")}
                  className="rounded-lg bg-warn px-4 py-3 font-semibold text-ink disabled:opacity-40"
                >
                  Acknowledge
                </button>
              ) : null}
              {operator ? (
                <button
                  type="button"
                  disabled={!canResolve(current.state) || action.isPending}
                  onClick={() => action.mutate("resolve")}
                  className="rounded-lg bg-slate-100 px-4 py-3 font-semibold text-ink disabled:opacity-40"
                >
                  Resolve
                </button>
              ) : null}
              {operator ? (
                <button
                  type="button"
                  disabled={!canResolve(current.state) || action.isPending}
                  onClick={() => {
                    void api(`/api/v1/incidents/${id}/false-alarm`, token, {
                      method: "POST",
                      body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
                    }).then(() => queryClient.invalidateQueries()).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "False-alarm closure failed."));
                  }}
                  className="rounded-lg border border-warn px-4 py-3 font-semibold text-warn disabled:opacity-40"
                >
                  Close as false alarm
                </button>
              ) : null}
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
                  disabled={!responderId || action.isPending}
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
                <>
                  {validResponderActions(responderStatus).map(([status, label]) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => {
                        void api(`/api/v1/incidents/${id}/responder-status`, token, {
                          method: "POST",
                          body: JSON.stringify({ status }),
                        }).then(() => queryClient.invalidateQueries()).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Update failed."));
                      }}
                      className="rounded-lg border border-line px-4 py-3 font-semibold"
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
            </div>
          </section>
        </div>
        ) : null}
        </>
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


function validResponderActions(status: string): ReadonlyArray<readonly [string, string]> {
  switch (status) {
    case "ASSIGNED": return [["ACCEPTED", "Accept assignment"], ["DECLINED", "Decline assignment"]];
    case "ACCEPTED": return [["EN_ROUTE", "En route"], ["DECLINED", "Decline assignment"]];
    case "EN_ROUTE":
    case "RESPONDING": return [["ON_SCENE", "On scene"], ["DECLINED", "Decline assignment"]];
    case "ON_SCENE": return [["USER_LOCATED", "Report person located"], ["COMPLETED", "Complete assignment"]];
    case "USER_LOCATED": return [["COMPLETED", "Complete assignment"]];
    default: return [];
  }
}
