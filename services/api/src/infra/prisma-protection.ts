import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  EvidenceStore,
  GuardianStore,
  JourneyRecord,
  JourneyStore,
  PinStore,
  RiskStore,
  TrustedContactRecord,
} from "../domain/protection-service";

export class PrismaGuardianStore implements GuardianStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(contact: TrustedContactRecord): Promise<void> {
    await this.prisma.trustedContact.create({
      data: { ...contact, updatedAt: contact.createdAt },
    });
  }

  async list(userId: string): Promise<TrustedContactRecord[]> {
    const rows = await this.prisma.trustedContact.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    return rows.map(toGuardian);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.trustedContact.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }

  async findByInvitationToken(token: string): Promise<TrustedContactRecord | null> {
    const row = await this.prisma.trustedContact.findUnique({ where: { invitationToken: token } });
    return row ? toGuardian(row) : null;
  }

  async save(contact: TrustedContactRecord): Promise<void> {
    await this.prisma.trustedContact.update({
      where: { id: contact.id },
      data: {
        displayName: contact.displayName,
        phone: contact.phone,
        email: contact.email,
        canViewLocation: contact.canViewLocation,
        canViewEvidence: contact.canViewEvidence,
        relationship: contact.relationship ?? "FRIEND",
        priority: contact.priority ?? 1,
        notificationMethods: contact.notificationMethods ?? "PUSH,SMS",
        guardianUserId: contact.guardianUserId ?? null,
        invitationStatus: contact.invitationStatus ?? "ACCEPTED",
        invitationToken: contact.invitationToken ?? null,
      },
    });
  }
}

function toGuardian(row: {
  id: string;
  userId: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  canViewLocation: boolean;
  canViewEvidence: boolean;
  canCancelIncident: boolean;
  relationship: string;
  priority: number;
  notificationMethods: string;
  guardianUserId: string | null;
  invitationStatus: string;
  invitationToken: string | null;
  createdAt: Date;
}): TrustedContactRecord {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    phone: row.phone,
    email: row.email,
    canViewLocation: row.canViewLocation,
    canViewEvidence: row.canViewEvidence,
    canCancelIncident: row.canCancelIncident,
    relationship: row.relationship,
    priority: row.priority,
    notificationMethods: row.notificationMethods,
    guardianUserId: row.guardianUserId,
    invitationStatus: row.invitationStatus,
    invitationToken: row.invitationToken,
    createdAt: row.createdAt,
  };
}

export class PrismaJourneyStore implements JourneyStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(journey: JourneyRecord): Promise<void> {
    const now = new Date();
    await this.prisma.protectionSession.create({ data: { ...journey, createdAt: now, updatedAt: now } });
  }

  async find(id: string, userId: string): Promise<JourneyRecord | null> {
    const row = await this.prisma.protectionSession.findFirst({ where: { id, userId } });
    return row ? toJourney(row) : null;
  }

  async save(journey: JourneyRecord): Promise<void> {
    await this.prisma.protectionSession.update({
      where: { id: journey.id },
      data: {
        lastCheckInAt: journey.lastCheckInAt,
        status: journey.status,
        expectedArrivalAt: journey.expectedArrivalAt,
        updatedAt: new Date(),
      },
    });
  }

  async listActive(): Promise<JourneyRecord[]> {
    const rows = await this.prisma.protectionSession.findMany({ where: { status: { in: ["ACTIVE", "CONCERN"] } } });
    return rows.map(toJourney);
  }
}

function toJourney(row: {
  id: string;
  userId: string;
  destinationLabel: string;
  expectedArrivalAt: Date;
  checkInIntervalSeconds: number;
  lastCheckInAt: Date;
  status: string;
  mode: string;
  originLatitude: number | null;
  originLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  corridorMeters: number;
}): JourneyRecord {
  const mode = row.mode === "RIDE" || row.mode === "DRIVE" || row.mode === "MEETING" || row.mode === "HIGH_RISK" ? row.mode : "WALK";
  return {
    id: row.id,
    userId: row.userId,
    destinationLabel: row.destinationLabel,
    expectedArrivalAt: row.expectedArrivalAt,
    checkInIntervalSeconds: row.checkInIntervalSeconds,
    lastCheckInAt: row.lastCheckInAt,
    status: row.status === "COMPLETED" || row.status === "CONCERN" ? row.status : "ACTIVE",
    mode,
    originLatitude: row.originLatitude,
    originLongitude: row.originLongitude,
    destinationLatitude: row.destinationLatitude,
    destinationLongitude: row.destinationLongitude,
    corridorMeters: row.corridorMeters,
  };
}

export class PrismaRiskStore implements RiskStore {
  constructor(private readonly prisma: PrismaClient) {}

  async record(signal: { id: string; userId: string; sessionId: string; type: string; createdAt: Date }): Promise<"created" | "exists"> {
    try {
      await this.prisma.riskSignal.create({ data: { ...signal, updatedAt: signal.createdAt } });
      return "created";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "exists";
      throw error;
    }
  }
}

export class PrismaPinStore implements PinStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string) {
    const row = await this.prisma.safetyPin.findUnique({ where: { userId } });
    return row ? { userId: row.userId, cancelPinHash: row.cancelPinHash, duressPinHash: row.duressPinHash } : null;
  }

  async save(record: { userId: string; cancelPinHash: string; duressPinHash: string }): Promise<void> {
    const now = new Date();
    await this.prisma.safetyPin.upsert({
      where: { userId: record.userId },
      create: { ...record, createdAt: now, updatedAt: now },
      update: { cancelPinHash: record.cancelPinHash, duressPinHash: record.duressPinHash, updatedAt: now },
    });
  }
}

export class PrismaEvidenceStore implements EvidenceStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(chunk: {
    id: string;
    incidentId: string;
    clientChunkId: string;
    sequence: number;
    sha256: string;
    contentType: string;
    byteLength: number;
    storageKey?: string | null;
    payload: Buffer;
    createdAt: Date;
  }): Promise<"created" | "exists"> {
    try {
      await this.prisma.evidenceChunk.create({
        data: {
          ...chunk,
          storageKey: chunk.storageKey ?? null,
          payload: new Uint8Array(chunk.payload),
          updatedAt: chunk.createdAt,
        },
      });
      return "created";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "exists";
      throw error;
    }
  }

  async list(incidentId: string) {
    const rows = await this.prisma.evidenceChunk.findMany({
      where: { incidentId },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        incidentId: true,
        clientChunkId: true,
        sequence: true,
        sha256: true,
        byteLength: true,
        contentType: true,
        storageKey: true,
      },
    });
    return rows;
  }
}
