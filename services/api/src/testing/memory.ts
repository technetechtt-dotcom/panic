import { randomUUID } from "node:crypto";
import { UniqueConflictError } from "../domain/errors";
import type {
  AuditRecord,
  AuditStore,
  Clock,
  ConsentStore,
  DeviceRecord,
  DeviceStore,
  HeartbeatStore,
  IdGenerator,
  IncidentRecord,
  IncidentStore,
  LocationStore,
  RefreshTokenRecord,
  RefreshTokenStore,
  StoredHeartbeat,
  StoredLocation,
  StoredTimelineEvent,
  TimelineStore,
  UserRecord,
  UserStore,
} from "../domain/ports";
import { ACTIVE_STATES } from "../domain/ports";

export class ManualClock implements Clock {
  constructor(public current = new Date("2026-10-01T09:00:00.000Z")) {}
  now(): Date {
    return this.current;
  }
}

export class RandomIds implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

export class MemoryUsers implements UserStore {
  readonly rows = new Map<string, UserRecord>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    return [...this.rows.values()].find((user) => user.email === email) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async insert(user: UserRecord): Promise<void> {
    if ([...this.rows.values()].some((row) => row.email === user.email)) throw new UniqueConflictError();
    this.rows.set(user.id, user);
  }
}

export class MemoryRefreshTokens implements RefreshTokenStore {
  readonly rows = new Map<string, RefreshTokenRecord>();

  async insert(token: RefreshTokenRecord): Promise<void> {
    this.rows.set(token.id, token);
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return [...this.rows.values()].find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async revoke(id: string, revokedAt: Date, replacedById?: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.revokedAt = revokedAt;
    row.replacedById = replacedById ?? null;
  }

  async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.familyId === familyId && !row.revokedAt) row.revokedAt = revokedAt;
    }
  }
}

export class MemoryConsents implements ConsentStore {
  readonly rows: Array<Parameters<ConsentStore["insert"]>[0]> = [];
  async insert(record: Parameters<ConsentStore["insert"]>[0]): Promise<void> {
    this.rows.push(record);
  }
}

export class MemoryDevices implements DeviceStore {
  readonly rows = new Map<string, DeviceRecord>();

  async insert(device: DeviceRecord): Promise<void> {
    const clash = [...this.rows.values()].find(
      (row) => row.userId === device.userId && row.devicePublicId === device.devicePublicId,
    );
    if (clash) throw new UniqueConflictError();
    this.rows.set(device.id, device);
  }

  async save(device: DeviceRecord): Promise<void> {
    this.rows.set(device.id, device);
  }

  async findByIdForUser(id: string, userId: string): Promise<DeviceRecord | null> {
    const device = this.rows.get(id);
    return device && device.userId === userId ? device : null;
  }

  async findByPublicId(userId: string, devicePublicId: string): Promise<DeviceRecord | null> {
    return (
      [...this.rows.values()].find((row) => row.userId === userId && row.devicePublicId === devicePublicId) ?? null
    );
  }

  async listForUser(userId: string): Promise<DeviceRecord[]> {
    return [...this.rows.values()].filter((row) => row.userId === userId);
  }
}

export class MemoryIncidents implements IncidentStore {
  readonly rows = new Map<string, IncidentRecord>();
  readonly escalations = new Map<string, { incidentId: string }>();

  async findByTriggerId(triggerId: string): Promise<IncidentRecord | null> {
    return [...this.rows.values()].find((row) => row.triggerId === triggerId) ?? null;
  }

  async findById(id: string): Promise<IncidentRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async findActiveForUser(userId: string): Promise<IncidentRecord | null> {
    return (
      [...this.rows.values()]
        .filter((row) => row.userId === userId && ACTIVE_STATES.has(row.state))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async findEscalation(triggerId: string): Promise<{ incidentId: string } | null> {
    return this.escalations.get(triggerId) ?? null;
  }

  async recordEscalation(event: {
    id: string;
    incidentId: string;
    triggerId: string;
    triggerType: IncidentRecord["triggerType"];
    createdAt: Date;
  }): Promise<"created" | "exists"> {
    if (this.escalations.has(event.triggerId)) return "exists";
    this.escalations.set(event.triggerId, { incidentId: event.incidentId });
    return "created";
  }

  async insert(incident: IncidentRecord): Promise<void> {
    if (await this.findByTriggerId(incident.triggerId)) throw new UniqueConflictError();
    this.rows.set(incident.id, structuredClone(incident));
  }

  async save(incident: IncidentRecord): Promise<void> {
    this.rows.set(incident.id, structuredClone(incident));
  }

  async listActive(): Promise<IncidentRecord[]> {
    return [...this.rows.values()]
      .filter((row) => ACTIVE_STATES.has(row.state))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listForUser(userId: string): Promise<IncidentRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export class MemoryLocations implements LocationStore {
  readonly rows: StoredLocation[] = [];

  async insertIfAbsent(point: StoredLocation): Promise<"created" | "exists"> {
    const exists = this.rows.some(
      (row) => row.incidentId === point.incidentId && row.clientPointId === point.clientPointId,
    );
    if (exists) return "exists";
    this.rows.push(structuredClone(point));
    return "created";
  }

  async list(incidentId: string): Promise<StoredLocation[]> {
    return this.rows
      .filter((row) => row.incidentId === incidentId)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }
}

export class MemoryHeartbeats implements HeartbeatStore {
  readonly rows: StoredHeartbeat[] = [];

  async insertIfAbsent(heartbeat: StoredHeartbeat): Promise<"created" | "exists"> {
    const exists = this.rows.some(
      (row) => row.incidentId === heartbeat.incidentId && row.clientHeartbeatId === heartbeat.clientHeartbeatId,
    );
    if (exists) return "exists";
    this.rows.push(structuredClone(heartbeat));
    return "created";
  }

  async list(incidentId: string, limit: number): Promise<StoredHeartbeat[]> {
    return this.rows
      .filter((row) => row.incidentId === incidentId)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, limit);
  }
}

export class MemoryTimeline implements TimelineStore {
  readonly rows: StoredTimelineEvent[] = [];
  async append(event: StoredTimelineEvent): Promise<void> {
    this.rows.push(event);
  }
  async list(incidentId: string): Promise<StoredTimelineEvent[]> {
    return this.rows
      .filter((row) => row.incidentId === incidentId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}

export class MemoryAudit implements AuditStore {
  readonly rows: AuditRecord[] = [];
  async append(event: AuditRecord): Promise<void> {
    this.rows.push(event);
  }
  async list(limit: number): Promise<AuditRecord[]> {
    return [...this.rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
}

export function createMemory() {
  return {
    users: new MemoryUsers(),
    refreshTokens: new MemoryRefreshTokens(),
    consents: new MemoryConsents(),
    devices: new MemoryDevices(),
    incidents: new MemoryIncidents(),
    locations: new MemoryLocations(),
    heartbeats: new MemoryHeartbeats(),
    timeline: new MemoryTimeline(),
    audit: new MemoryAudit(),
    clock: new ManualClock(),
    ids: new RandomIds(),
  };
}
