export const ROLES = [
  "USER",
  "GUARDIAN",
  "MONITOR_OPERATOR",
  "SUPERVISOR",
  "RESPONDER",
  "ADMIN",
] as const;
export type Role = (typeof ROLES)[number];

export const INCIDENT_STATES = [
  "PROTECTED",
  "CONCERN",
  "HIGH_RISK",
  "SOS",
  "ACKNOWLEDGED",
  "RESPONDING",
  "USER_LOCATED",
  "RESOLVED",
  "ARCHIVED",
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export const TRIGGER_TYPES = [
  "VOLUME_BUTTON",
  "VOICE_SAFE_WORD",
  "MANUAL_SOS",
  "JOURNEY_TIMEOUT",
  "WEARABLE",
  "FALL_OR_IMPACT",
  "SAFETY_CHECK_FAILURE",
  "DURESS",
  "SYSTEM_RISK_ESCALATION",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** Deliberate triggers create an incident immediately. They never wait on risk scoring or an AI model. */
export const DELIBERATE_TRIGGER_TYPES = [
  "VOLUME_BUTTON",
  "VOICE_SAFE_WORD",
  "MANUAL_SOS",
  "DURESS",
] as const;
export type DeliberateTriggerType = (typeof DELIBERATE_TRIGGER_TYPES)[number];

export const ACTIVE_INCIDENT_STATES = [
  "SOS",
  "ACKNOWLEDGED",
  "RESPONDING",
  "USER_LOCATED",
  "CONCERN",
  "HIGH_RISK",
] as const;

export const NETWORK_TYPES = [
  "WIFI",
  "CELLULAR",
  "NO_INTERNET",
  "POOR_NETWORK",
  "UNKNOWN",
] as const;
export type NetworkType = (typeof NETWORK_TYPES)[number];

export const PROTECTION_MODES = [
  "NORMAL",
  "WALK",
  "RIDE",
  "DRIVE",
  "MEETING",
  "HIGH_RISK",
  "CUSTOM",
] as const;
export type ProtectionMode = (typeof PROTECTION_MODES)[number];

export const PROTECTION_STATUSES = [
  "PROTECTED",
  "LIMITED_PROTECTION",
  "PROTECTION_OFF",
] as const;
export type ProtectionStatus = (typeof PROTECTION_STATUSES)[number];

export const CONTACT_STATUSES = ["ONLINE", "DEVICE_CONTACT_LOST"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const LOCATION_SOURCES = ["GPS", "NETWORK", "FUSED", "LAST_KNOWN"] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export const UPLOAD_PRIORITIES = ["CRITICAL", "HIGH", "NORMAL", "BULK"] as const;
export type UploadPriority = (typeof UPLOAD_PRIORITIES)[number];

export interface LastKnownLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: string;
}

export interface DistressCapsule {
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  chargingStatus: boolean;
  networkType: NetworkType;
  protectionMode: ProtectionMode;
  duress: boolean;
  lastKnownLocation: LastKnownLocation | null;
  appProtectionStatus: ProtectionStatus;
}

export interface IncidentLocationPoint {
  id: string;
  clientPointId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  bearing: number | null;
  altitude: number | null;
  recordedAt: string;
  source: LocationSource;
}

export interface Heartbeat {
  id: string;
  clientHeartbeatId: string;
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  charging: boolean;
  networkType: NetworkType;
  deviceOnline: boolean;
  evidenceStatus: "NONE";
  permissionsStatus: string;
  batteryMode: "NORMAL" | "REDUCED" | "SURVIVAL" | "CRITICAL_ONLY";
}

export interface TimelineEntry {
  id: string;
  type: string;
  message: string;
  occurredAt: string;
  actorId: string | null;
}

export interface Incident {
  id: string;
  userId: string;
  deviceId: string;
  triggerId: string;
  triggerType: TriggerType;
  state: IncidentState;
  isTest: boolean;
  duress: boolean;
  correlationId: string;
  protectionMode: ProtectionMode;
  contactStatus: ContactStatus;
  contactLostAt: string | null;
  lastHeartbeatAt: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastAccuracy: number | null;
  lastSpeed: number | null;
  lastHeading: number | null;
  lastBattery: number | null;
  distressCapsule: DistressCapsule;
  userDisplayName: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentSummary {
  activeIncidents: number;
  unacknowledgedIncidents: number;
  duressAlerts: number;
  devicesContactLost: number;
  /** Fusion-driven high-risk alerts are not produced in this version. */
  highRiskAlerts: null;
  /** Responder assignment is not available in this version. */
  respondersActive: null;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface AuthSession {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  user: AuthUser;
}

export const REALTIME_EVENTS = [
  "incident.created",
  "incident.updated",
  "incident.acknowledged",
  "location.updated",
  "heartbeat.updated",
  "device.offline",
  "incident.resolved",
] as const;
export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];

/** Catalogued for later milestones. This version does not emit them. */
export const FUTURE_REALTIME_EVENTS = [
  "evidence.received",
  "risk.updated",
  "duress.detected",
  "guardian.notified",
  "responder.assigned",
] as const;
