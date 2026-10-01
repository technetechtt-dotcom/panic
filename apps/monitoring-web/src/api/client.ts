export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export interface Incident {
  id: string;
  userDisplayName: string;
  triggerType: string;
  state: string;
  isTest: boolean;
  duress: boolean;
  correlationId: string;
  protectionMode: string;
  contactStatus: string;
  contactLostAt: string | null;
  lastHeartbeatAt: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastAccuracy: number | null;
  lastSpeed: number | null;
  lastHeading: number | null;
  lastBattery: number | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  distressCapsule: {
    batteryLevel: number | null;
    networkType: string;
    appProtectionStatus: string;
  };
}

export interface IncidentSummary {
  activeIncidents: number;
  unacknowledgedIncidents: number;
  duressAlerts: number;
  devicesContactLost: number;
  highRiskAlerts: null;
  respondersActive: null;
}

export interface TimelineEntry {
  id: string;
  type: string;
  message: string;
  occurredAt: string;
}

export interface LocationPoint {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  bearing: number | null;
  recordedAt: string;
  source: string;
}

export interface Heartbeat {
  id: string;
  recordedAt: string;
  batteryLevel: number | null;
  networkType: string;
  deviceOnline: boolean;
  batteryMode: string;
}

const base = import.meta.env.VITE_API_BASE_URL ?? "";

let publishToken: ((token: string | null) => void) | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function bindSession(_token: string | null, publish: (token: string | null) => void): void {
  publishToken = publish;
}

export function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = api<{ accessToken: string }>("/api/v1/auth/refresh", null, {
      method: "POST",
      body: JSON.stringify({}),
    }, false)
      .then((data) => {
        publishToken?.(data.accessToken);
        return data.accessToken;
      })
      .catch(() => {
        publishToken?.(null);
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function api<T>(path: string, token: string | null, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { ...init, headers, credentials: "include" });
  const body = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string; code?: string } };
  if (response.status === 401 && allowRefresh && !path.endsWith("/auth/login") && !path.endsWith("/auth/refresh")) {
    const renewed = await refreshSession();
    if (renewed) return api<T>(path, renewed, init, false);
  }
  if (!response.ok) {
    const unavailable = response.status === 502 || response.status === 503 || (response.status === 500 && !body.error?.message);
    throw new ApiError(
      body.error?.message ??
        (unavailable
          ? "The Guardian API is not running. Start PostgreSQL, then run npm run dev:api."
          : "Request failed"),
      response.status,
      body.error?.code ?? (unavailable ? "API_UNAVAILABLE" : "HTTP_ERROR"),
    );
  }
  return body.data as T;
}
