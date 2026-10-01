import { Prisma, type IncidentState, type PrismaClient } from "@prisma/client";
import type { DistressCapsule } from "@guardian/shared-types";
import { UniqueConflictError } from "../domain/errors";
import type {
  AuditRecord,
  AuditStore,
  ConsentStore,
  DeviceRecord,
  DeviceStore,
  HeartbeatStore,
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

function rethrow(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new UniqueConflictError();
  }
  throw error;
}

const incidentInclude = { user: { select: { displayName: true } } } satisfies Prisma.IncidentInclude;

type IncidentRow = Prisma.IncidentGetPayload<{ include: typeof incidentInclude }>;

function mapIncident(row: IncidentRow): IncidentRecord {
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    triggerId: row.triggerId,
    triggerType: row.triggerType,
    requestHash: row.requestHash,
    state: row.state,
    isTest: row.isTest,
    duress: row.duress,
    correlationId: row.correlationId,
    protectionMode: row.protectionMode,
    contactStatus: row.contactStatus,
    contactLostAt: row.contactLostAt,
    capsule: row.capsuleJson as unknown as DistressCapsule,
    lastHeartbeatAt: row.lastHeartbeatAt,
    lastPositionAt: row.lastPositionAt,
    lastLatitude: row.lastLatitude,
    lastLongitude: row.lastLongitude,
    lastAccuracy: row.lastAccuracy,
    lastSpeed: row.lastSpeed,
    lastHeading: row.lastHeading,
    lastBattery: row.lastBattery,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedById: row.acknowledgedById,
    resolvedAt: row.resolvedAt,
    resolvedById: row.resolvedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    userDisplayName: row.user.displayName,
  };
}

export class PrismaUserStore implements UserStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async insert(user: UserRecord): Promise<void> {
    try {
      await this.prisma.user.create({ data: user });
    } catch (error) {
      rethrow(error);
    }
  }
}

export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(token: RefreshTokenRecord): Promise<void> {
    await this.prisma.refreshToken.create({ data: token });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revoke(id: string, revokedAt: Date, replacedById?: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt, replacedById: replacedById ?? null },
    });
  }

  async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt },
    });
  }
}

export class PrismaConsentStore implements ConsentStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(record: Parameters<ConsentStore["insert"]>[0]): Promise<void> {
    await this.prisma.consentRecord.create({ data: record });
  }
}

export class PrismaDeviceStore implements DeviceStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(device: DeviceRecord): Promise<void> {
    try {
      await this.prisma.device.create({ data: device });
    } catch (error) {
      rethrow(error);
    }
  }

  async findByIdForUser(id: string, userId: string): Promise<DeviceRecord | null> {
    const row = await this.prisma.device.findFirst({ where: { id, userId } });
    return row ? toDeviceRecord(row) : null;
  }

  async findByPublicId(userId: string, devicePublicId: string): Promise<DeviceRecord | null> {
    const row = await this.prisma.device.findUnique({ where: { userId_devicePublicId: { userId, devicePublicId } } });
    return row ? toDeviceRecord(row) : null;
  }

  async listForUser(userId: string): Promise<DeviceRecord[]> {
    const rows = await this.prisma.device.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return rows.map(toDeviceRecord);
  }

  async save(device: DeviceRecord): Promise<void> {
    await this.prisma.device.update({
      where: { id: device.id },
      data: { publicKey: device.publicKey ?? null, updatedAt: device.updatedAt },
    });
  }
}

function toDeviceRecord(row: {
  id: string;
  userId: string;
  devicePublicId: string;
  platform: string;
  manufacturer: string | null;
  model: string | null;
  osVersion: string;
  appVersion: string;
  publicKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DeviceRecord {
  if (row.platform !== "ANDROID") {
    throw new Error("Stored device platform is not ANDROID.");
  }
  return { ...row, platform: "ANDROID" };
}

export class PrismaIncidentStore implements IncidentStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findByTriggerId(triggerId: string): Promise<IncidentRecord | null> {
    const row = await this.prisma.incident.findUnique({ where: { triggerId }, include: incidentInclude });
    return row ? mapIncident(row) : null;
  }

  async findById(id: string): Promise<IncidentRecord | null> {
    const row = await this.prisma.incident.findUnique({ where: { id }, include: incidentInclude });
    return row ? mapIncident(row) : null;
  }

  async insert(incident: IncidentRecord): Promise<void> {
    try {
      await this.prisma.incident.create({
        data: {
          id: incident.id,
          userId: incident.userId,
          deviceId: incident.deviceId,
          triggerId: incident.triggerId,
          triggerType: incident.triggerType,
          requestHash: incident.requestHash,
          state: incident.state,
          isTest: incident.isTest,
          duress: incident.duress,
          correlationId: incident.correlationId,
          protectionMode: incident.protectionMode,
          contactStatus: incident.contactStatus,
          contactLostAt: incident.contactLostAt,
          capsuleJson: incident.capsule as unknown as Prisma.InputJsonValue,
          lastHeartbeatAt: incident.lastHeartbeatAt,
          lastPositionAt: incident.lastPositionAt,
          lastLatitude: incident.lastLatitude,
          lastLongitude: incident.lastLongitude,
          lastAccuracy: incident.lastAccuracy,
          lastSpeed: incident.lastSpeed,
          lastHeading: incident.lastHeading,
          lastBattery: incident.lastBattery,
          acknowledgedAt: incident.acknowledgedAt,
          acknowledgedById: incident.acknowledgedById,
          resolvedAt: incident.resolvedAt,
          resolvedById: incident.resolvedById,
          createdAt: incident.createdAt,
        },
      });
    } catch (error) {
      rethrow(error);
    }
  }

  async save(incident: IncidentRecord): Promise<void> {
    await this.prisma.incident.update({
      where: { id: incident.id },
      data: {
        state: incident.state,
        contactStatus: incident.contactStatus,
        contactLostAt: incident.contactLostAt,
        lastHeartbeatAt: incident.lastHeartbeatAt,
        lastPositionAt: incident.lastPositionAt,
        lastLatitude: incident.lastLatitude,
        lastLongitude: incident.lastLongitude,
        lastAccuracy: incident.lastAccuracy,
        lastSpeed: incident.lastSpeed,
        lastHeading: incident.lastHeading,
        lastBattery: incident.lastBattery,
        acknowledgedAt: incident.acknowledgedAt,
        acknowledgedById: incident.acknowledgedById,
        resolvedAt: incident.resolvedAt,
        resolvedById: incident.resolvedById,
        isTest: incident.isTest,
        duress: incident.duress,
      },
    });
  }

  async findActiveForUser(userId: string): Promise<IncidentRecord | null> {
    const row = await this.prisma.incident.findFirst({
      where: { userId, state: { in: [...ACTIVE_STATES] as IncidentState[] } },
      include: incidentInclude,
      orderBy: { createdAt: "desc" },
    });
    return row ? mapIncident(row) : null;
  }

  async findEscalation(triggerId: string): Promise<{ incidentId: string } | null> {
    const row = await this.prisma.incidentEscalation.findUnique({ where: { triggerId } });
    return row ? { incidentId: row.incidentId } : null;
  }

  async recordEscalation(event: {
    id: string;
    incidentId: string;
    triggerId: string;
    triggerType: IncidentRecord["triggerType"];
    createdAt: Date;
  }): Promise<"created" | "exists"> {
    try {
      await this.prisma.incidentEscalation.create({ data: { ...event, updatedAt: event.createdAt } });
      return "created";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "exists";
      throw error;
    }
  }

  async listActive(): Promise<IncidentRecord[]> {
    const rows = await this.prisma.incident.findMany({
      where: { state: { in: [...ACTIVE_STATES] as IncidentState[] } },
      include: incidentInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map(mapIncident);
  }

  async listForUser(userId: string): Promise<IncidentRecord[]> {
    const rows = await this.prisma.incident.findMany({
      where: { userId },
      include: incidentInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map(mapIncident);
  }
}

export class PrismaLocationStore implements LocationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insertIfAbsent(point: StoredLocation): Promise<"created" | "exists"> {
    try {
      await this.prisma.incidentLocation.create({
        data: { ...point, recordedAt: new Date(point.recordedAt) },
      });
      return "created";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "exists";
      throw error;
    }
  }

  async list(incidentId: string): Promise<StoredLocation[]> {
    const rows = await this.prisma.incidentLocation.findMany({
      where: { incidentId },
      orderBy: { recordedAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      clientPointId: row.clientPointId,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      speed: row.speed,
      bearing: row.bearing,
      altitude: row.altitude,
      recordedAt: row.recordedAt.toISOString(),
      source: row.source as StoredLocation["source"],
    }));
  }
}

export class PrismaHeartbeatStore implements HeartbeatStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insertIfAbsent(heartbeat: StoredHeartbeat): Promise<"created" | "exists"> {
    try {
      await this.prisma.deviceHeartbeat.create({
        data: {
          ...heartbeat,
          recordedAt: new Date(heartbeat.recordedAt),
        },
      });
      return "created";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "exists";
      throw error;
    }
  }

  async list(incidentId: string, limit: number): Promise<StoredHeartbeat[]> {
    const rows = await this.prisma.deviceHeartbeat.findMany({
      where: { incidentId },
      orderBy: { recordedAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      clientHeartbeatId: row.clientHeartbeatId,
      recordedAt: row.recordedAt.toISOString(),
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      speed: row.speed,
      heading: row.heading,
      batteryLevel: row.batteryLevel,
      charging: row.charging,
      networkType: row.networkType as StoredHeartbeat["networkType"],
      deviceOnline: row.deviceOnline,
      evidenceStatus: "NONE",
      permissionsStatus: row.permissionsStatus,
      batteryMode: row.batteryMode as StoredHeartbeat["batteryMode"],
    }));
  }
}

export class PrismaTimelineStore implements TimelineStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: StoredTimelineEvent): Promise<void> {
    await this.prisma.timelineEvent.create({
      data: {
        id: event.id,
        incidentId: event.incidentId,
        type: event.type,
        message: event.message,
        occurredAt: new Date(event.occurredAt),
        actorId: event.actorId,
      },
    });
  }

  async list(incidentId: string): Promise<StoredTimelineEvent[]> {
    const rows = await this.prisma.timelineEvent.findMany({
      where: { incidentId },
      orderBy: { occurredAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      type: row.type,
      message: row.message,
      occurredAt: row.occurredAt.toISOString(),
      actorId: row.actorId,
    }));
  }
}

export class PrismaAuditStore implements AuditStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: AuditRecord): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        ...event,
        metadata: event.metadata === null ? Prisma.JsonNull : (event.metadata as Prisma.InputJsonValue),
      },
    });
  }

  async list(limit: number): Promise<AuditRecord[]> {
    const rows = await this.prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      correlationId: row.correlationId,
      requestId: row.requestId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
    }));
  }
}
