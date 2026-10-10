import { useMemo, useState } from "react";
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
  metadata?: Record<string, unknown> | null;
}

export function AuditPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const rows = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<AuditRow[]>("/api/v1/audit?limit=100", token),
  });
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows.data ?? []).filter((row) => {
      if (action && row.action !== action) return false;
      if (!needle) return true;
      return [row.action, row.entityType, row.entityId, row.actorId ?? ""].join(" ").toLowerCase().includes(needle);
    });
  }, [action, query, rows.data]);
  const actions = Array.from(new Set((rows.data ?? []).map((row) => row.action)));

  return (
      <main className="px-4 py-6">
        <h1 className="text-3xl font-semibold">Audit</h1>
        <p className="mt-2 text-sm text-slate-300">The latest operator actions stored for this server. This is not a complete legal record.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actor, incident, or entity" className="rounded-lg border border-line bg-ink px-3 py-2" />
          <select value={action} onChange={(event) => setAction(event.target.value)} className="rounded-lg border border-line bg-ink px-3 py-2">
            <option value="">All actions</option>
            {actions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg border border-line px-3 py-2 text-sm"
          onClick={() => {
            const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "guardian-audit.json";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export filtered rows
        </button>
        {rows.isError ? <p className="mt-4 text-sos">The audit log could not be loaded.</p> : null}
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {filtered.map((row) => (
            <li key={row.id} className="px-4 py-3 text-sm">
              <p className="font-semibold">{row.action}</p>
              <p className="text-slate-300">
                {row.entityType} · {row.entityId}
              </p>
              <p className="text-xs text-slate-400">{new Date(row.createdAt).toLocaleString()} · actor {row.actorId ?? "system"}</p>
              {row.metadata ? <pre className="mt-2 overflow-auto text-xs text-slate-400">{JSON.stringify(row.metadata)}</pre> : null}
            </li>
          ))}
          {filtered.length === 0 ? <li className="px-4 py-8 text-slate-300">No audit rows yet.</li> : null}
        </ul>
      </main>
  );
}
