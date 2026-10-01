import type {
  ContactStatus,
  DistressCapsule,
  Heartbeat,
  IncidentLocationPoint,
  IncidentState,
  NetworkType,
  Role,
  TimelineEntry,
  TriggerType,
} from "@guardian/shared-types";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  insert(user: UserRecord): Promise<void>;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
}

export interface RefreshTokenStore {
  insert(token: RefreshTokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string, revokedAt: Date, replacedById?: string): Promise<void>;
  revokeFamily(familyId: string, revokedAt: Date): Promise<void>;
}

export interface ConsentStore {
  insert(record: {
    id: string;
    userId: string;
    purpose: string;
    version: string;
    granted: boolean;
    createdAt: Date;
  }): Promise<void>;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  devicePublicId: string;
  platform: "ANDROID";
  manufacturer: string | null;
  model: string | null;
  osVersion: string;
  appVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceStore {
  insert(device: DeviceRecord): Promise<void>;
  findByIdForUser(id: string, userId: string): Promise<DeviceRecord | null>;
  findByPublicId(userId: string, devicePublicId: string): Promise<DeviceRecord | null>;
  listForUser(userId: string): Promise<DeviceRecord[]>;
}

export interface IncidentRecord {
  id: string;
  userId: string;
  deviceId: string;
  triggerId: string;
  triggerType: TriggerType;
  requestHash: string;
  state: IncidentState;
  isTest: boolean;
  duress: boolean;
  correlationId: string;
  protectionMode: string;
  contactStatus: ContactStatus;
  contactLostAt: Date | null;
  capsule: DistressCapsule;
  lastHeartbeatAt: Date | null;
  lastPositionAt: Date | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastAccuracy: number | null;
  lastSpeed: number | null;
  lastHeading: number | null;
  lastBattery: number | null;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  userDisplayName: string;
}

export interface IncidentStore {
  findByTriggerId(triggerId: string): Promise<IncidentRecord | null>;
  findById(id: string): Promise<IncidentRecord | null>;
  insert(incident: IncidentRecord): Promise<void>;
  save(incident: IncidentRecord): Promise<void>;
  listActive(): Promise<IncidentRecord[]>;
  listForUser(userId: string): Promise<IncidentRecord[]>;
}

export interface StoredLocation extends IncidentLocationPoint {
  incidentId: string;
}

export interface LocationStore {
  insertIfAbsent(point: StoredLocation): Promise<"created" | "exists">;
  list(incidentId: string): Promise<StoredLocation[]>;
}

export interface StoredHeartbeat extends Heartbeat {
  incidentId: string;
}

export interface HeartbeatStore {
  insertIfAbsent(heartbeat: StoredHeartbeat): Promise<"created" | "exists">;
  list(incidentId: string, limit: number): Promise<StoredHeartbeat[]>;
}

export interface StoredTimelineEvent extends TimelineEntry {
  incidentId: string;
}

export interface TimelineStore {
  append(event: StoredTimelineEvent): Promise<void>;
  list(incidentId: string): Promise<StoredTimelineEvent[]>;
}

export interface AuditRecord {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditStore {
  append(event: AuditRecord): Promise<void>;
  list(limit: number): Promise<AuditRecord[]>;
}

export interface RealtimePublisher {
  publish(name: string, payload: unknown): void;
}

export interface Actor {
  id: string;
  role: Role;
  displayName: string;
}

export const ACTIVE_STATES = new Set([
  "SOS",
  "ACKNOWLEDGED",
  "RESPONDING",
  "USER_LOCATED",
  "CONCERN",
  "HIGH_RISK",
]);

export function triggerLabel(triggerType: TriggerType): string {
  switch (triggerType) {
    case "MANUAL_SOS":
      return "Manual SOS";
    case "VOLUME_BUTTON":
      return "Volume button";
    case "VOICE_SAFE_WORD":
      return "Safe word";
    case "DURESS":
      return "Duress";
    default:
      return triggerType;
  }
}

export type { NetworkType };
