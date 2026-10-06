import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Shell } from "../components/Shell";

interface PlatformStatus {
  postgres: "up" | "down";
  smsConfigured: boolean;
  fcmConfigured: boolean;
  apnsConfigured: boolean;
  s3Configured: boolean;
  vault: string;
  requests: number;
  serverErrors: number;
}

export function PlatformPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const status = useQuery({
    queryKey: ["platform"],
    queryFn: () => api<PlatformStatus>("/api/v1/admin/platform", token),
    refetchInterval: 15_000,
  });
  const row = status.data;

  return (
    <Shell>
      <main className="px-4 py-6">
        <h1 className="text-3xl font-semibold">Platform</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          This page shows whether this process can reach its dependencies. A configured flag means the secret is present. It does not mean a message was delivered.
        </p>
        {status.isError ? <p className="mt-4 text-sos">Platform status could not be loaded.</p> : null}
        <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tile label="Postgres" value={row ? row.postgres : "—"} />
          <Tile label="SMS provider" value={flag(row?.smsConfigured)} />
          <Tile label="FCM" value={flag(row?.fcmConfigured)} />
          <Tile label="APNs" value={flag(row?.apnsConfigured)} />
          <Tile label="S3 vault" value={flag(row?.s3Configured)} />
          <Tile label="Local evidence vault" value={row?.vault ?? "—"} />
          <Tile label="HTTP requests" value={row ? String(row.requests) : "—"} />
          <Tile label="Server errors" value={row ? String(row.serverErrors) : "—"} />
        </section>
        <section className="mt-8 max-w-3xl space-y-3 text-sm text-slate-300">
          <h2 className="text-xl font-semibold text-white">What is running</h2>
          <p>Deliberate SOS does not wait for Safety Fusion. Fusion can open a concern or high-risk incident from a missed check-in on the server.</p>
          <p>Search Corridor is a map hint around the last confirmed point. It is not a claim about where the person is.</p>
          <p>The rules brief restates the timeline. It cannot cancel, accuse, or dispatch.</p>
          <p>Evidence is encrypted on this server. An S3 copy is written only when the bucket settings are present.</p>
          <p>High availability in this repo is two API containers sharing one Postgres and one Redis. That is not a multi-region cluster.</p>
          <p>Disaster recovery is a Postgres dump from services/api/scripts/backup-restore.mjs. Restoring that dump has to be rehearsed on a spare database before it counts as a drill.</p>
          <h2 className="pt-2 text-xl font-semibold text-white">POPIA operating steps</h2>
          <p>These steps are the in-product process. They are not a legal filing or a certificate.</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Collect only the account, device, location, and incident data described in the privacy note.</li>
            <li>Operators with incident access can read an open incident. Supervisors can read the audit log. People can export their own account and erase the profile with their password.</li>
            <li>Do not copy evidence bytes into chat, email, or a ticket. Use the incident evidence viewer.</li>
            <li>A subject request uses export, then erase. Incident rows stay so an open emergency is not deleted by the erase call.</li>
            <li>A suspected breach is recorded by a supervisor in the audit trail and escalated to the responsible party. This screen does not notify a regulator.</li>
          </ol>
        </section>
      </main>
    </Shell>
  );
}

function flag(value: boolean | undefined): string {
  if (value == null) return "—";
  return value ? "Configured" : "Not configured";
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </article>
  );
}
