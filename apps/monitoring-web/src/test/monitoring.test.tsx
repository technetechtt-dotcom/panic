import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "../pages/LoginPage";
import { IncidentsPage } from "../pages/IncidentsPage";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    session: { accessToken: "token", user: { id: "1", email: "op@example.com", displayName: "Op", role: "MONITOR_OPERATOR" } },
    restoring: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../api/socket", () => ({
  useMonitorSocket: () => undefined,
}));

describe("monitoring hub", () => {
  it("does not submit a short operator password", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText("Email"), "op@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the operator email and password.");
  });

  it("marks a practice incident as a test and keeps it out of the metric wording", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith("/api/v1/incidents/summary")) {
          return json({
            activeIncidents: 1,
            unacknowledgedIncidents: 1,
            duressAlerts: 0,
            devicesContactLost: 0,
            highRiskAlerts: null,
            respondersActive: null,
          });
        }
        return json([
          {
            id: "inc-1",
            userDisplayName: "Alex",
            triggerType: "MANUAL_SOS",
            state: "SOS",
            isTest: true,
            duress: false,
            contactStatus: "ONLINE",
          },
        ]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <IncidentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("TEST INCIDENT")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText(/Counts exclude test incidents/)).toBeInTheDocument();
  });
});

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
}
