import { useState } from "react";
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
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (caught: unknown) => setError(caught instanceof Error ? caught.message : "The role was not changed."),
  });

  return (
      <main className="px-4 py-6">
        <h1 className="text-3xl font-semibold">People</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Supervisors can assign user, guardian, operator, and responder roles. Only an administrator can assign an administrator. You cannot change your own role. Passwords and PINs are not shown here.
        </p>
        {users.isError ? <p className="mt-4 text-sos">The account list could not be loaded.</p> : null}
        {error ? <p className="mt-4 text-sos">{error}</p> : null}
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {(users.data ?? []).map((account) => (
            <li key={account.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_220px]">
              <div>
                <p className="text-lg font-semibold">{account.displayName}</p>
                <p className="text-sm text-slate-300">{account.email}</p>
                <p className="text-xs text-slate-400">{account.id}</p>
              </div>
              <label className="text-sm">
                Role
                <select
                  aria-label={`Role for ${account.displayName}`}
                  className="mt-1 w-full rounded-lg border border-line bg-ink p-2"
                  value={account.role}
                  disabled={account.id === session?.user.id || save.isPending}
                  onChange={(event) => save.mutate({ id: account.id, role: event.target.value })}
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
