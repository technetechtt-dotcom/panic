import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../api/client";

interface Room {
  displayName: string;
  state: string;
  triggerType: string;
  location: { latitude: number | null; longitude: number | null; accuracy: number | null } | null;
  evidence: Array<{ sequence: number; contentType: string; byteLength: number }>;
  notice: string;
}

export function RoomPage() {
  const { token = "" } = useParams();
  const room = useQuery({
    queryKey: ["room", token],
    queryFn: () => api<Room>(`/api/v1/rooms/${token}`, null),
    enabled: token.length > 20,
  });
  const current = room.data;
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <p className="text-sm uppercase tracking-[0.2em] text-warn">Guardian room</p>
      <h1 className="mt-2 text-3xl font-semibold">Private incident</h1>
      {room.isError ? <p className="mt-6 text-sos">This room is closed or the link is not valid.</p> : null}
      {current ? (
        <section className="mt-6 rounded-2xl border border-line bg-panel p-4">
          <p className="text-xl font-semibold">{current.displayName}</p>
          <p className="mt-2 text-sm">Status {current.state} · {current.triggerType}</p>
          <p className="mt-3 text-sm">
            {current.location?.latitude != null && current.location.longitude != null
              ? `Last confirmed location ${current.location.latitude.toFixed(5)}, ${current.location.longitude.toFixed(5)}`
              : "Location is not shared with this room."}
          </p>
          <p className="mt-3 text-sm">
            {current.evidence.length > 0
              ? `${current.evidence.length} evidence items are listed. The bytes stay with the monitoring hub.`
              : "Evidence bytes are not included in this room."}
          </p>
          <p className="mt-4 text-sm text-slate-300">{current.notice}</p>
        </section>
      ) : null}
    </main>
  );
}
