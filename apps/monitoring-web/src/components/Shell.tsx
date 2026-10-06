import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useMonitorSocket } from "../api/socket";

export function Shell({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const role = session?.user.role ?? "";
  const manage = role === "ADMIN" || role === "SUPERVISOR";
  const platform = role === "ADMIN" || role === "SUPERVISOR" || role === "MONITOR_OPERATOR";
  const queryClient = useQueryClient();
  const [alarm, setAlarm] = useState(false);
  useMonitorSocket(session?.accessToken ?? null, (name) => {
    void queryClient.invalidateQueries();
    if (name === "incident.created" || name === "duress.detected") setAlarm(true);
  });

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
        {alarm ? (
          <p className="border-b border-line bg-sos px-4 py-3 text-sm font-semibold">
            A new SOS or duress flag arrived.{" "}
            <Link to="/" className="underline" onClick={() => setAlarm(false)}>
              Open incidents
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
