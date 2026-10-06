import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Shell } from "./components/Shell";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { AuditPage } from "./pages/AuditPage";
import { LoginPage } from "./pages/LoginPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PlatformPage } from "./pages/PlatformPage";
import { RoomPage } from "./pages/RoomPage";

const PLATFORM_ROLES = ["ADMIN", "SUPERVISOR", "MONITOR_OPERATOR"];
const MANAGE_ROLES = ["ADMIN", "SUPERVISOR"];

export function App() {
  const { session, restoring } = useAuth();
  if (restoring) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <p>Restoring the operator session.</p>
      </main>
    );
  }
  return (
    <Routes>
      <Route path="/room/:token" element={<RoomPage />} />
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={session ? <HubLayout /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<IncidentsPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/platform" element={<RolePage allow={PLATFORM_ROLES}><PlatformPage /></RolePage>} />
        <Route path="/people" element={<RolePage allow={MANAGE_ROLES}><PeoplePage /></RolePage>} />
        <Route path="/audit" element={<RolePage allow={MANAGE_ROLES}><AuditPage /></RolePage>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function HubLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

function RolePage({ allow, children }: { allow: string[]; children: ReactNode }) {
  const { session } = useAuth();
  if (!session || !allow.includes(session.user.role)) return <Navigate to="/" replace />;
  return children;
}
