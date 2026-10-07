import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Incident } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useMonitorSocket } from "../api/socket";

export function Shell({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const role = session?.user.role ?? "";
  const manage = role === "ADMIN" || role === "SUPERVISOR";
  const platform = role === "ADMIN" || role === "SUPERVISOR" || role === "MONITOR_OPERATOR";
  const queryClient = useQueryClient();
  const [alarm, setAlarm] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const token = session?.accessToken ?? null;
  const incidents = useQuery({
    queryKey: ["incidents"],
    enabled: Boolean(token),
    queryFn: () => api<Incident[]>("/api/v1/incidents", token),
    refetchInterval: 5_000,
  });
  const openSos = useMemo(
    () => (incidents.data ?? []).filter((row) => row.state === "SOS" && !row.isTest && !row.acknowledgedAt),
    [incidents.data],
  );
  const overdue = openSos.find((row) => Date.now() - new Date(row.createdAt).getTime() >= 30_000);

  useMonitorSocket(session?.accessToken ?? null, (name) => {
    void queryClient.invalidateQueries();
    if (name === "incident.created" || name === "duress.detected") setAlarm(true);
  });

  useEffect(() => {
    if (openSos.length === 0) {
      setAlarm(false);
      return;
    }
    setAlarm(true);
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Guardian SOS", { body: `${openSos.length} unacknowledged SOS waiting.` });
    }
    try {
      audioRef.current ??= new AudioContext();
      const ctx = audioRef.current;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.05;
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.4);
    } catch {
      // Audio is blocked until the operator interacts with the page.
    }
  }, [openSos.length]);

  const remaining = openSos[0]
    ? Math.max(0, 30 - Math.floor((Date.now() - new Date(openSos[0].createdAt).getTime()) / 1000))
    : 0;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-panel px-4 py-4 md:border-b-0 md:border-r">
        <p className="text-sm uppercase tracking-[0.2em] text-warn">Guardian</p>
        <p className="mt-1 text-sm text-slate-300">{session?.user.displayName}</p>
        <p className="text-xs text-slate-400">{role.replace(/_/g, " ")}</p>
        <nav className="mt-4 flex flex-wrap gap-2 md:flex-col">
          <NavItem to="/">Incidents</NavItem>
          {manage ? <NavItem to="/people">People</NavItem> : null}
          {platform ? <NavItem to="/platform">Platform</NavItem> : null}
          {manage ? <NavItem to="/audit">Audit</NavItem> : null}
        </nav>
        <button type="button" onClick={() => void logout()} className="mt-4 rounded-lg border border-line px-3 py-2 text-sm">
          Sign out
        </button>
      </aside>
      <div>
        {alarm && openSos[0] ? (
          <p className="border-b border-line bg-sos px-4 py-3 text-sm font-semibold">
            Unacknowledged SOS. Operator claim countdown {remaining}s.
            {overdue ? " Escalated to a supervisor after 30 seconds without an ack." : ""}{" "}
            <Link to={`/incidents/${openSos[0].id}`} className="underline" onClick={() => setAlarm(false)}>
              Open incident
            </Link>
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "text-slate-200 hover:bg-ink/60"}`
      }
    >
      {children}
    </NavLink>
  );
}
