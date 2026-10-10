import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Account {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}

const ROLES = ["USER", "GUARDIAN", "MONITOR_OPERATOR", "SUPERVISOR", "RESPONDER", "ADMIN"];

export function PeoplePage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [pending, setPending] = useState<{ id: string; role: string; name: string } | null>(null);
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<Account[]>("/api/v1/admin/users", token),
  });
  const save = useMutation({
    mutationFn: async (input: { id: string; role: string }) => {
      await api(`/api/v1/admin/users/${input.id}/role`, token, {
        method: "POST",
        body: JSON.stringify({ role: input.role }),
      });
    },
    onSuccess: async () => {
      setError(null);
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (caught: unknown) => setError(caught instanceof Error ? caught.message : "The role was not changed."),
  });
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (users.data ?? []).filter((account) => {
      if (roleFilter !== "ALL" && account.role !== roleFilter) return false;
      if (!needle) return true;
      return [account.displayName, account.email, account.id, account.role].join(" ").toLowerCase().includes(needle);
    });
  }, [query, roleFilter, users.data]);

  return (
      <main className="px-4 py-6">
        <h1 className="text-3xl font-semibold">People</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Supervisors can assign user, guardian, operator, and responder roles. Only an administrator can assign an administrator. You cannot change your own role. Passwords and PINs are not shown here.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" className="rounded-lg border border-line bg-ink px-3 py-2" />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="rounded-lg border border-line bg-ink px-3 py-2">
            <option value="ALL">All roles</option>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>
        {users.isError ? <p className="mt-4 text-sos">The account list could not be loaded.</p> : null}
        {error ? <p className="mt-4 text-sos">{error}</p> : null}
        {pending ? (
          <div className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm">
            <p>Change {pending.name} to {pending.role}? High-risk roles can view incidents and dispatch responders.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className="rounded-lg bg-slate-100 px-3 py-2 font-semibold text-ink" onClick={() => save.mutate({ id: pending.id, role: pending.role })}>
                Confirm role change
              </button>
              <button type="button" className="rounded-lg border border-line px-3 py-2" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        ) : null}
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {rows.map((account) => (
            <li key={account.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_220px]">
              <div>
                <p className="text-lg font-semibold">{account.displayName}</p>
                <p className="break-all text-sm text-slate-300">{account.email}</p>
                <p className="break-all text-xs text-slate-400">{account.id}</p>
              </div>
              <label className="text-sm">
                Role
                <select
                  aria-label={`Role for ${account.displayName}`}
                  className="mt-1 w-full rounded-lg border border-line bg-ink p-2"
                  value={account.role}
                  disabled={account.id === session?.user.id || save.isPending}
                  onChange={(event) => setPending({ id: account.id, role: event.target.value, name: account.displayName })}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      </main>
  );
}
