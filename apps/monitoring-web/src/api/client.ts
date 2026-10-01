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

export async function api<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { ...init, headers, credentials: "include" });
  const body = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string; code?: string } };
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
