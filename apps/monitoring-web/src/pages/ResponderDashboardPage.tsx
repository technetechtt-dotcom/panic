import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Incident } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export const responderStages = ["ASSIGNED", "ACCEPTED", "EN_ROUTE", "ON_SCENE", "USER_LOCATED", "COMPLETED"];
const labels: Record<string, string> = { ASSIGNED: "Assigned", ACCEPTED: "Accepted", EN_ROUTE: "En route", ON_SCENE: "On scene", USER_LOCATED: "Located", COMPLETED: "Completed", DECLINED: "Declined" };
const next: Record<string, string[]> = { ASSIGNED: ["ACCEPTED", "DECLINED"], ACCEPTED: ["EN_ROUTE", "DECLINED"], EN_ROUTE: ["ON_SCENE", "DECLINED"], ON_SCENE: ["USER_LOCATED", "COMPLETED"], USER_LOCATED: ["COMPLETED"] };
export function responderActions(status: string): Array<[string, string]> {
  const actionLabels: Record<string, string> = { ACCEPTED: "Accept assignment", USER_LOCATED: "Report person located", COMPLETED: "Complete assignment", DECLINED: "Decline assignment" };
  return (next[status === "RESPONDING" ? "EN_ROUTE" : status] ?? []).map(value => [value, actionLabels[value] ?? labels[value]!]);
}
export function ResponderDashboardPage() {
  const { session } = useAuth();
  const assignments = useQuery({ queryKey: ["incidents"], queryFn: () => api<Incident[]>("/api/v1/incidents", session?.accessToken ?? null), refetchInterval: 5_000 });
  return <main className="mx-auto max-w-6xl px-4 py-6">
    <h1 className="text-3xl font-semibold">Responder dashboard</h1>
    <p className="mt-2 text-slate-300">Your assignments and response progress.</p>
    {assignments.isPending ? <p role="status" className="mt-4">Loading assignments…</p> : null}
    {assignments.isError ? <p role="alert" className="mt-4 text-sos">Assignments could not be loaded. <button onClick={() => void assignments.refetch()}>Retry</button></p> : null}
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Assignment progress">
      {responderStages.map(stage => <article key={stage} className="rounded-xl border border-line bg-panel p-4"><h2>{labels[stage]}</h2><p className="text-2xl">{(assignments.data ?? []).filter(row => row.assignment === stage).length}</p></article>)}
    </section>
    <ul className="mt-6 space-y-3">{(assignments.data ?? []).map(row => <li key={row.id} className="rounded-xl border border-line p-4"><Link className="underline" to={`/incidents/${row.id}`}>{row.userDisplayName} · {labels[row.assignment ?? "ASSIGNED"] ?? row.assignment}</Link>{row.isTest ? " · TEST" : ""}</li>)}</ul>
    {assignments.data?.length === 0 ? <p className="mt-4">No current assignments.</p> : null}
  </main>;
}
