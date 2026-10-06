import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Shell } from "../components/Shell";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actorId: string | null;
}

export function AuditPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const rows = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<AuditRow[]>("/api/v1/audit?limit=50", token),
  });

  return (
    <Shell>
      <main className="px-4 py-6">
        <h1 className="text-3xl font-semibold">Audit</h1>
        <p className="mt-2 text-sm text-slate-300">The latest operator actions stored for this server. This is not a complete legal record.</p>
        {rows.isError ? <p className="mt-4 text-sos">The audit log could not be loaded.</p> : null}
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {(rows.data ?? []).map((row) => (
            <li key={row.id} className="px-4 py-3 text-sm">
              <p className="font-semibold">{row.action}</p>
              <p className="text-slate-300">
                {row.entityType} · {row.entityId}
              </p>
              <p className="text-xs text-slate-400">{new Date(row.createdAt).toLocaleString()}</p>
            </li>
          ))}
          {rows.data?.length === 0 ? <li className="px-4 py-8 text-slate-300">No audit rows yet.</li> : null}
        </ul>
      </main>
    </Shell>
  );
}
