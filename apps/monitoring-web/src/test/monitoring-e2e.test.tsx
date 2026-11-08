import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IncidentDetailPage } from "../pages/IncidentDetailPage";

const session = {
  accessToken: "token",
  user: { id: "resp-1", email: "r@example.com", displayName: "Riley", role: "RESPONDER" },
};

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    session,
    restoring: false,
    login: vi.fn(),
    completeMfa: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../api/socket", () => ({
  useMonitorSocket: () => undefined,
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  Polygon: () => null,
  CircleMarker: () => null,
}));

const incident = {
  id: "inc-live",
  userDisplayName: "Alex",
  triggerType: "MANUAL_SOS",
  state: "SOS",
  isTest: false,
  duress: false,
  correlationId: "corr",
  protectionMode: "NORMAL",
  contactStatus: "ONLINE",
  contactLostAt: null,
  lastHeartbeatAt: "2026-10-11T11:00:00.000Z",
  lastLatitude: -26.2,
  lastLongitude: 28.04,
  lastAccuracy: 8,
  lastSpeed: null,
  lastHeading: null,
  lastBattery: 71,
  createdAt: "2026-10-11T10:59:00.000Z",
  acknowledgedAt: null,
  resolvedAt: null,
  claimedBy: "op-1",
  claimedAt: "2026-10-11T11:00:00.000Z",
  escalatedToSupervisorAt: null,
  distressCapsule: { batteryLevel: 71, networkType: "CELLULAR", appProtectionStatus: "PROTECTED" },
};

describe("monitoring incident workflow", () => {
  let assignmentStatus = "ASSIGNED";
  beforeEach(() => {
    assignmentStatus = "ASSIGNED";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/responder-status") && init?.method === "POST") {
          assignmentStatus = JSON.parse(String(init.body)).status;
          return json({ ok: true });
        }
        if (url.endsWith("/api/v1/incidents")) return json([{ ...incident, assignment: assignmentStatus }]);
        if (url.endsWith("/api/v1/incidents/inc-live")) return json(incident);
        if (url.endsWith("/timeline")) return json([{ id: "t1", type: "CREATED", message: "SOS opened", occurredAt: incident.createdAt }]);
        if (url.endsWith("/locations")) return json([{ id: "p1", latitude: -26.2, longitude: 28.04, accuracy: 8, speed: null, bearing: null, recordedAt: incident.createdAt, source: "gps" }]);
        if (url.endsWith("/heartbeats")) return json([{ id: "h1", recordedAt: incident.lastHeartbeatAt, batteryLevel: 71, networkType: "CELLULAR" }]);
        if (url.endsWith("/deliveries")) return json([]);
        if (url.endsWith("/evidence")) return json([]);
        return json(null);
      }),
    );
  });

  it("shows live incident fields and the responder state workflow", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/incidents/inc-live"]}>
          <Routes>
            <Route path="/incidents/:id" element={<IncidentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getByText(/Contact:/)).toHaveTextContent("ONLINE");
    expect(await screen.findByRole("button", { name: "Accept assignment" })).toBeInTheDocument();
    for (const name of ["Acknowledge", "En route", "On scene", "Report person located", "Complete assignment"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    for (const name of ["evidence", "guardians", "responders", "intelligence", "communications"]) expect(screen.queryByRole("tab", { name })).not.toBeInTheDocument();
    for (const [label, status] of [["Accept assignment", "ACCEPTED"], ["En route", "EN_ROUTE"], ["On scene", "ON_SCENE"], ["Report person located", "USER_LOCATED"], ["Complete assignment", "COMPLETED"]]) {
      await user.click(await screen.findByRole("button", { name: label }));
      await waitFor(() => expect(assignmentStatus).toBe(status));
    }
    await waitFor(() => expect(screen.queryByRole("button", { name: "Complete assignment" })).not.toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.some(call => /\/summary|\/deliveries|\/evidence|\/communications|\/ai\//.test(String(call[0])))).toBe(false);
    const profile = screen.getByRole("tab", { name: "profile" });
    await user.click(profile);
    expect(document.querySelectorAll("#incident-panel-profile")).toHaveLength(1);
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "timeline" })).toHaveFocus();

  });
});

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
}
