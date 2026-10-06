import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { AuditPage } from "./pages/AuditPage";
import { LoginPage } from "./pages/LoginPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PlatformPage } from "./pages/PlatformPage";
import { RoomPage } from "./pages/RoomPage";

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
      <Route path="/" element={session ? <IncidentsPage /> : <Navigate to="/login" replace />} />
      <Route path="/people" element={session ? <PeoplePage /> : <Navigate to="/login" replace />} />
      <Route path="/platform" element={session ? <PlatformPage /> : <Navigate to="/login" replace />} />
      <Route path="/audit" element={session ? <AuditPage /> : <Navigate to="/login" replace />} />
      <Route path="/incidents/:id" element={session ? <IncidentDetailPage /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
