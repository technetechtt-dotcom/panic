import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { LoginPage } from "./pages/LoginPage";

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
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={session ? <IncidentsPage /> : <Navigate to="/login" replace />} />
      <Route path="/incidents/:id" element={session ? <IncidentDetailPage /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
