import { randomBytes, randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Role } from "@guardian/shared-types";
import type { AppConfig } from "../config";
import { FileEvidenceVault, s3Configured } from "./evidence-vault";
import { AppError } from "./errors";
import { canAssignRole, hasPermission, Permission } from "./rbac";
import { IncidentService } from "./incident-service";
import { canAdvanceResponder, fusionEvaluate, generateTotpSecret, guardianSmsBody, haversineMeters, incidentBrief, normalizeResponderStatus, searchCorridor, verifyTotp } from "./operations";
import { ProtectionService } from "./protection-service";
import type { Actor, Clock, DeviceStore, IdGenerator, UserStore } from "./ports";
import type { PasswordHasher } from "./security";
import { hashToken, openSecret, sealSecret, sha256 } from "./security";
import { apnsHealth, fcmHealth, sendApns, sendFcm, smsHealth, TwilioSmsProvider } from "./sms";
import { requestMetrics } from "../common/http";
import type { MfaStore } from "./auth-service";
import type { AiService } from "./ai-service";
import type { OutboxService } from "./outbox";
import { etaSeconds } from "./scheduler-lock";
import { websocketStatus } from "../modules/realtime/realtime-status";
import { sendTransactionalEmail } from "./email";
import { geocodeDestination } from "./geocode";

const OPERATOR_ROLES: Role[] = ["MONITOR_OPERATOR", "SUPERVISOR", "RESPONDER", "ADMIN"];

async function latestEncryptedBackup(directory: string | undefined): Promise<string> {
  if (!directory?.trim()) return process.env.LAST_BACKUP_AT ?? "not configured";
  try {
    const files = (await readdir(directory)).filter((name) => name.startsWith("guardian-") && name.endsWith(".sql.enc"));
    if (!files.length) return "no encrypted backup found";
    const rows = await Promise.all(files.map(async (name) => ({ name, info: await stat(join(directory, name)) })));
    rows.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    const newest = rows[0]!;
    return `${newest.info.mtime.toISOString()} · ${newest.name}`;
  } catch {
    return process.env.LAST_BACKUP_AT ?? "backup directory unavailable";
  }
}

function maskDestination(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "saved contact";
  return `···${trimmed.slice(-4)}`;
}

export class PlatformService {
  private readonly sms = new TwilioSmsProvider();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly incidents: IncidentService,
    private readonly protection: ProtectionService,
    private readonly users: UserStore,
    private readonly devices: DeviceStore,
    private readonly passwords: PasswordHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly vault: FileEvidenceVault,
    private readonly outbox: OutboxService | null = null,
    private readonly redis: { ping(): Promise<"up" | "down" | "unconfigured"> } | null = null,
    private readonly ai: AiService | null = null,
  ) {}

  async queueAiAssessment(incidentId: string): Promise<void> {
    if (this.outbox) {
      await this.outbox.enqueue({
        type: "AI_ASSESS",
        aggregateType: "Incident",
        aggregateId: incidentId,
        payload: { incidentId },
      });
      return;
    }
    await this.ai?.assess(incidentId);
  }

  async queueOpenIncidentAssessments(limit = 200): Promise<number> {
    const rows = await this.prisma.incident.findMany({
      where: {
        state: { in: ["CONCERN", "HIGH_RISK", "SOS", "ACKNOWLEDGED", "RESPONDING", "USER_LOCATED"] },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.max(1, Math.min(500, limit)),
      select: { id: true },
    });
    for (const row of rows) {
      await this.queueAiAssessment(row.id);
    }
    return rows.length;
  }

  async notifyIncident(incident: { id: string; userId: string; userDisplayName: string; state: string; isTest: boolean }): Promise<void> {
    if (this.outbox) {
      if (!incident.isTest) {
        await this.outbox.enqueue({
          type: "INCIDENT_GUARDIAN_NOTIFY",
          aggregateType: "Incident",
          aggregateId: incident.id,
          payload: {
            incidentId: incident.id,
            userId: incident.userId,
            userDisplayName: incident.userDisplayName,
            state: incident.state,
          },
        });
      }
      await this.outbox.enqueue({
        type: "AI_ASSESS",
        aggregateType: "Incident",
        aggregateId: incident.id,
        payload: { incidentId: incident.id },
      });
      return;
    }
    if (!incident.isTest) await this.dispatchGuardianNotify(incident);
  }

  async dispatchGuardianNotify(incident: { id?: string; incidentId?: string; userId: string; userDisplayName: string; state: string }): Promise<void> {
    const incidentId = incident.id ?? incident.incidentId;
    if (!incidentId) throw new Error("Guardian notify requires an incident id.");
    const contacts = await this.prisma.trustedContact.findMany({
      where: { userId: incident.userId, invitationStatus: { not: "DECLINED" } },
      orderBy: { priority: "asc" },
    });
    for (const contact of contacts) {
      const methods = (contact.notificationMethods || "PUSH,SMS").split(",").map((item) => item.trim().toUpperCase());
      const room = await this.openRoom(incidentId, contact.canViewLocation, contact.canViewEvidence, contact.id, contact.displayName);
      const body = guardianSmsBody({
        name: incident.userDisplayName,
        incidentState: incident.state,
        roomUrl: room.url,
      });
      if (methods.includes("SMS")) {
        const sms = contact.phone
          ? await this.sms.send({ to: contact.phone, body, incidentId })
          : { delivered: false, simulated: true, reason: "This guardian has no phone number.", providerMessageId: undefined };
        await this.record(incidentId, "SMS", contact.phone ?? contact.email ?? contact.displayName, sms.delivered ? "SENT" : "SKIPPED", sms.reason, sms.providerMessageId, contact.id);
      }
      await this.record(incidentId, "ROOM", contact.displayName, "SENT", "A private room link was created for this guardian.", undefined, contact.id);
      if (methods.includes("PUSH") && contact.guardianUserId) {
        const guardianPhones = await this.prisma.device.findMany({
          where: { userId: contact.guardianUserId, fcmToken: { not: null }, revokedAt: null },
        });
        for (const phone of guardianPhones) {
          if (!phone.fcmToken) continue;
          const apple = phone.platform === "IOS";
          const pushData = {
            type: "GUARDIAN_INCIDENT",
            incidentId,
            trustedContactId: contact.id,
            roomUrl: room.url,
          };
          const push = apple
            ? await sendApns(phone.fcmToken, "Guardian", `${incident.userDisplayName} needs help.`, process.env, pushData)
            : await sendFcm(phone.fcmToken, "Guardian", `${incident.userDisplayName} needs help.`, process.env, pushData);
          await this.record(
            incidentId,
            apple ? "APNS" : "FCM",
            contact.displayName,
            push.delivered ? "SENT" : "SKIPPED",
            push.reason,
            push.providerMessageId,
            contact.id,
          );
        }
      }
    }
  }

  async brief(actor: Actor, incidentId: string) {
    this.operator(actor);
    const incident = await this.incidents.get(actor, incidentId);
    const timeline = await this.incidents.timelineFor(actor, incidentId);
    return incidentBrief({
      displayName: incident.userDisplayName,
      state: incident.state,
      triggerType: incident.triggerType,
      duress: incident.duress,
      contactStatus: incident.contactStatus,
      isTest: incident.isTest,
      protectionMode: incident.protectionMode,
      timeline: timeline.map((entry) => entry.message),
    });
  }

  async corridor(actor: Actor, incidentId: string) {
    this.operator(actor);
    const points = await this.incidents.locationsFor(actor, incidentId);
    const incident = await this.incidents.get(actor, incidentId);
    const samples = points.map((point) => ({ latitude: point.latitude, longitude: point.longitude, heading: point.bearing }));
    if (samples.length === 0 && incident.lastLatitude !== null && incident.lastLongitude !== null) {
      samples.push({ latitude: incident.lastLatitude, longitude: incident.lastLongitude, heading: incident.lastHeading });
    }
    return searchCorridor(samples);
  }

  async evidence(actor: Actor, incidentId: string) {
    this.operator(actor);
    await this.incidents.get(actor, incidentId);
    return this.prisma.evidenceChunk.findMany({
      where: { incidentId },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        clientChunkId: true,
        sequence: true,
        contentType: true,
        byteLength: true,
        sha256: true,
        storageKey: true,
        createdAt: true,
        updatedAt: true,
      },
    }).then((rows) =>
      rows.map((row) => ({
        ...row,
        capturedAt: row.createdAt.toISOString(),
        uploadedAt: row.updatedAt.toISOString(),
      })),
    );
  }

  async liveCompanion(actor: Actor, incidentId: string) {
    const incident = await this.incidents.get(actor, incidentId);
    let deliveries: Array<{
      id: string;
      channel: string;
      status: string;
      detail: string;
      destination: string;
      providerMessageId?: string | null;
      sentAt?: Date | null;
      deliveredAt?: Date | null;
      acknowledgedAt?: Date | null;
    }> = [];
    let responders: Array<{
      responderId: string;
      status: string;
      acceptedAt: Date | null;
      enRouteAt: Date | null;
      arrivedAt: Date | null;
      locatedAt: Date | null;
      completedAt: Date | null;
      lastLatitude: number | null;
      lastLongitude: number | null;
      lastLocationAt: Date | null;
      speedMps: number | null;
    }> = [];
    let guardians: Array<{ id: string; displayName: string; lastAcknowledgedAt: Date | null; lastNotifiedAt: Date | null }> = [];
    try {
      deliveries = await this.prisma.notificationDelivery.findMany({
        where: { incidentId },
        orderBy: { createdAt: "desc" },
        take: 40,
      });
      responders = await this.prisma.responderAssignment.findMany({
        where: { incidentId },
        orderBy: { updatedAt: "desc" },
      });
      guardians = await this.prisma.trustedContact.findMany({
        where: { userId: incident.userId, active: true },
        select: { id: true, displayName: true, lastAcknowledgedAt: true, lastNotifiedAt: true },
        orderBy: { priority: "asc" },
      });
    } catch {
      // In-memory HTTP tests have no delivery tables. The incident itself still returns.
    }
    const userLat = incident.lastLatitude;
    const userLng = incident.lastLongitude;
    return {
      incident,
      deliveries: deliveries.map((row) => ({
        id: row.id,
        channel: row.channel,
        status: row.acknowledgedAt ? "ACKNOWLEDGED" : row.status,
        detail: row.detail,
        destination: maskDestination(row.destination),
        providerMessageId: row.providerMessageId,
        sentAt: row.sentAt?.toISOString?.() ?? row.sentAt,
        deliveredAt: row.deliveredAt?.toISOString?.() ?? row.deliveredAt,
        acknowledgedAt: row.acknowledgedAt?.toISOString?.() ?? row.acknowledgedAt ?? null,
      })),
      guardians: guardians.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        lastAcknowledgedAt: row.lastAcknowledgedAt?.toISOString?.() ?? row.lastAcknowledgedAt ?? null,
        lastNotifiedAt: row.lastNotifiedAt?.toISOString?.() ?? row.lastNotifiedAt ?? null,
        acknowledged: Boolean(row.lastAcknowledgedAt),
      })),
      responders: responders.map((row) => {
        const distanceMeters =
          userLat != null && userLng != null && row.lastLatitude != null && row.lastLongitude != null
            ? Math.round(haversineMeters(row.lastLatitude, row.lastLongitude, userLat, userLng))
            : null;
        const eta = distanceMeters == null ? null : etaSeconds(distanceMeters, row.speedMps);
        return {
          responderId: row.responderId,
          status: row.status,
          acceptedAt: row.acceptedAt?.toISOString?.() ?? row.acceptedAt,
          enRouteAt: row.enRouteAt?.toISOString?.() ?? row.enRouteAt,
          arrivedAt: row.arrivedAt?.toISOString?.() ?? row.arrivedAt,
          locatedAt: row.locatedAt?.toISOString?.() ?? row.locatedAt,
          completedAt: row.completedAt?.toISOString?.() ?? row.completedAt,
          latitude: row.lastLatitude,
          longitude: row.lastLongitude,
          locationAt: row.lastLocationAt?.toISOString?.() ?? row.lastLocationAt ?? null,
          distanceMeters,
          etaSeconds: eta,
        };
      }),
    };
  }

  async deliveries(actor: Actor, incidentId: string) {
    this.operator(actor);
    await this.incidents.get(actor, incidentId);
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { incidentId },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      status: row.status,
      detail: row.detail,
      destination: maskDestination(row.destination),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async evidenceBytes(actor: Actor, incidentId: string, chunkId: string): Promise<{ bytes: Buffer; contentType: string }> {
    this.operator(actor);
    const row = await this.prisma.evidenceChunk.findFirst({ where: { incidentId, id: chunkId } });
    if (!row) throw new AppError("NOT_FOUND", 404, "That evidence was not found.");
    const bytes = row.storageKey ? await this.vault.get(row.storageKey) : Buffer.from(row.payload);
    if (!bytes) throw new AppError("NOT_FOUND", 404, "The evidence file is not in the vault.");
    await this.prisma.auditEvent.create({
      data: {
        id: this.ids.uuid(),
        actorId: actor.id,
        action: "evidence.read",
        entityType: "EvidenceChunk",
        entityId: row.id,
        correlationId: incidentId,
        requestId: null,
        metadata: { incidentId, contentType: row.contentType },
        createdAt: this.clock.now(),
      },
    }).catch(() => undefined);
    await this.prisma.evidenceAccessLog.create({
      data: {
        id: this.ids.uuid(),
        incidentId,
        evidenceId: row.id,
        actorId: actor.id,
        action: "read",
      },
    }).catch(() => undefined);
    return { bytes, contentType: row.contentType };
  }

  async purgeExpiredEvidence(limit = 100): Promise<{ deleted: number; failed: number }> {
    const now = this.clock.now();
    const rows = await this.prisma.evidenceChunk.findMany({
      where: {
        legalHold: false,
        retentionUntil: { lte: now },
      },
      orderBy: { retentionUntil: "asc" },
      take: Math.max(1, Math.min(500, limit)),
      select: { id: true, incidentId: true, storageKey: true },
    });
    let deleted = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        if (row.storageKey) {
          const outcome = await this.vault.delete(row.storageKey);
          if (!outcome.localDeleted || !outcome.remoteDeleted) {
            failed += 1;
            continue;
          }
        }
        await this.prisma.$transaction([
          this.prisma.evidenceAccessLog.create({
            data: {
              id: this.ids.uuid(),
              incidentId: row.incidentId,
              evidenceId: row.id,
              actorId: null,
              action: "retention_delete",
              createdAt: now,
            },
          }),
          this.prisma.evidenceChunk.delete({ where: { id: row.id } }),
        ]);
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
    return { deleted, failed };
  }

  async evidenceManifest(actor: Actor, incidentId: string) {
    this.operator(actor);
    const incident = await this.incidents.get(actor, incidentId);
    const [chunks, access] = await Promise.all([
      this.prisma.evidenceChunk.findMany({
        where: { incidentId },
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          clientChunkId: true,
          sequence: true,
          sha256: true,
          contentType: true,
          byteLength: true,
          storageKey: true,
          retentionUntil: true,
          legalHold: true,
          retentionPolicy: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.evidenceAccessLog.findMany({
        where: { incidentId },
        orderBy: { createdAt: "asc" },
        take: 5000,
      }),
    ]);
    return {
      manifestVersion: 1,
      generatedAt: this.clock.now().toISOString(),
      incident: {
        id: incident.id,
        userId: incident.userId,
        triggerType: incident.triggerType,
        state: incident.state,
        isTest: incident.isTest,
        correlationId: incident.correlationId,
        createdAt: incident.createdAt,
      },
      evidence: chunks.map((row) => ({
        ...row,
        retentionUntil: row.retentionUntil?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      accessLog: access.map((row) => ({
        id: row.id,
        evidenceId: row.evidenceId,
        actorId: row.actorId,
        action: row.action,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async setEvidenceGovernance(
    actor: Actor,
    incidentId: string,
    input: { retentionDays?: number; legalHold: boolean; policy: string },
  ) {
    if (!hasPermission(actor.role, Permission.UserManage)) {
      throw new AppError("FORBIDDEN", 403, "Only supervisors or administrators can change evidence retention.");
    }
    await this.incidents.get(actor, incidentId);
    const now = this.clock.now();
    const retentionDays = input.retentionDays ?? Number(process.env.EVIDENCE_RETENTION_DAYS ?? 365);
    const retentionUntil = input.legalHold ? null : new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.evidenceChunk.updateMany({
      where: { incidentId },
      data: {
        legalHold: input.legalHold,
        retentionUntil,
        retentionPolicy: input.policy,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        id: this.ids.uuid(),
        actorId: actor.id,
        action: "evidence.governance_updated",
        entityType: "Incident",
        entityId: incidentId,
        correlationId: incidentId,
        requestId: null,
        metadata: {
          legalHold: input.legalHold,
          retentionDays,
          retentionUntil: retentionUntil?.toISOString() ?? null,
          policy: input.policy,
          chunks: updated.count,
        } as Prisma.InputJsonValue,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      incidentId,
      evidenceCount: updated.count,
      legalHold: input.legalHold,
      retentionDays,
      retentionUntil: retentionUntil?.toISOString() ?? null,
      policy: input.policy,
    };
  }

  async incidentArchive(
    actor: Actor,
    input: {
      page?: number;
      pageSize?: number;
      state?: string;
      trigger?: string;
      query?: string;
      from?: string;
      to?: string;
      isTest?: boolean;
      responderId?: string;
      operatorId?: string;
    },
  ) {
    this.operator(actor);
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(10, input.pageSize ?? 25));
    const where: Prisma.IncidentWhereInput = {};
    if (input.state && input.state !== "ALL") where.state = input.state as any;
    if (input.trigger && input.trigger !== "ALL") where.triggerType = input.trigger as any;
    if (typeof input.isTest === "boolean") where.isTest = input.isTest;
    if (input.operatorId) where.claimedBy = input.operatorId;
    if (input.responderId) where.assignments = { some: { responderId: input.responderId } };
    if (input.from || input.to) {
      where.createdAt = {
        ...(input.from ? { gte: new Date(input.from) } : {}),
        ...(input.to ? { lte: new Date(input.to) } : {}),
      };
    }
    const needle = input.query?.trim();
    if (needle) {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(needle) ? needle : null;
      where.OR = [
        ...(uuid ? [{ id: uuid }] : []),
        { user: { displayName: { contains: needle, mode: "insensitive" } } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.incident.count({ where }),
      this.prisma.incident.findMany({
        where,
        include: {
          user: { select: { displayName: true } },
          assignments: { select: { responderId: true, status: true, assignedAt: true, arrivedAt: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      items: rows.map((row) => ({
        id: row.id,
        userDisplayName: row.user.displayName,
        triggerType: row.triggerType,
        state: row.state,
        isTest: row.isTest,
        duress: row.duress,
        contactStatus: row.contactStatus,
        createdAt: row.createdAt.toISOString(),
        acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        claimedBy: row.claimedBy,
        responders: row.assignments.map((assignment) => ({
          responderId: assignment.responderId,
          status: assignment.status,
          assignedAt: assignment.assignedAt?.toISOString() ?? null,
          arrivedAt: assignment.arrivedAt?.toISOString() ?? null,
        })),
      })),
    };
  }

  async reportsOverview(actor: Actor, days = 30) {
    this.operator(actor);
    const boundedDays = Math.min(365, Math.max(1, days));
    const since = new Date(this.clock.now().getTime() - boundedDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.incident.findMany({
      where: { createdAt: { gte: since }, isTest: false },
      include: {
        assignments: true,
        deliveries: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const acknowledgements = rows
      .filter((row) => row.acknowledgedAt)
      .map((row) => row.acknowledgedAt!.getTime() - row.createdAt.getTime());
    const dispatches = rows
      .flatMap((row) => row.assignments.filter((a) => a.assignedAt).map((a) => a.assignedAt!.getTime() - row.createdAt.getTime()));
    const arrivals = rows
      .flatMap((row) => row.assignments.filter((a) => a.arrivedAt).map((a) => a.arrivedAt!.getTime() - row.createdAt.getTime()));
    const deliveries = rows.flatMap((row) => row.deliveries).filter((row) => ["SMS", "FCM", "APNS", "ROOM"].includes(row.channel));
    const delivered = deliveries.filter((row) => row.deliveredAt || row.status === "DELIVERED" || row.status === "ACKNOWLEDGED").length;
    const acknowledged = deliveries.filter((row) => row.acknowledgedAt).length;
    const byTrigger = Object.fromEntries(
      [...new Set(rows.map((row) => row.triggerType))].map((trigger) => [trigger, rows.filter((row) => row.triggerType === trigger).length]),
    );
    const byState = Object.fromEntries(
      [...new Set(rows.map((row) => row.state))].map((state) => [state, rows.filter((row) => row.state === state).length]),
    );
    const avg = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length / 1000) : null;
    return {
      windowDays: boundedDays,
      incidentCount: rows.length,
      averageAcknowledgementSeconds: avg(acknowledgements),
      averageDispatchSeconds: avg(dispatches),
      averageResponderArrivalSeconds: avg(arrivals),
      guardianDeliverySuccessRate: deliveries.length ? Math.round((delivered / deliveries.length) * 1000) / 10 : null,
      guardianAcknowledgementRate: deliveries.length ? Math.round((acknowledged / deliveries.length) * 1000) / 10 : null,
      falseAlarmRate: rows.length ? Math.round((rows.filter((row) => row.state === "FALSE_ALARM").length / rows.length) * 1000) / 10 : null,
      falseAlarmNote: "False alarms are counted only when an authorised operator explicitly closes an incident with the FALSE_ALARM outcome.",
      byTrigger,
      byState,
    };
  }

  async incidentEmergencyProfile(actor: Actor, incidentId: string) {
    await this.incidents.get(actor, incidentId);
    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId }, select: { userId: true } });
    if (!incident) throw new AppError("NOT_FOUND", 404, "That incident was not found.");
    const profile = await this.prisma.emergencyProfile.findUnique({ where: { userId: incident.userId } });
    return profile
      ? {
          bloodType: profile.bloodType,
          allergies: profile.allergies,
          medications: profile.medications,
          notes: profile.notes,
        }
      : { bloodType: null, allergies: null, medications: null, notes: null };
  }

  async incidentCommunications(actor: Actor, incidentId: string) {
    await this.incidents.get(actor, incidentId);
    const [timeline, deliveries] = await Promise.all([
      this.prisma.timelineEvent.findMany({ where: { incidentId }, orderBy: { occurredAt: "asc" }, take: 500 }),
      this.prisma.notificationDelivery.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, take: 500 }),
    ]);
    return [
      ...timeline.map((row) => ({
        id: row.id,
        at: row.occurredAt.toISOString(),
        kind: row.type,
        channel: "INTERNAL",
        message: row.message,
        status: null as string | null,
      })),
      ...deliveries.map((row) => ({
        id: row.id,
        at: (row.acknowledgedAt ?? row.deliveredAt ?? row.sentAt ?? row.createdAt).toISOString(),
        kind: "guardian.delivery",
        channel: row.channel,
        message: `${maskDestination(row.destination)} · ${row.detail}`,
        status: row.status,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
  }

  async guardianInbox(actor: Actor) {
    if (actor.role !== "GUARDIAN" && !hasPermission(actor.role, Permission.IncidentReadActive)) {
      throw new AppError("FORBIDDEN", 403, "This inbox is only available to Guardian or monitoring accounts.");
    }
    const contacts = await this.prisma.trustedContact.findMany({
      where: {
        guardianUserId: actor.id,
        invitationStatus: "ACCEPTED",
        active: true,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            incidents: {
              where: { state: { notIn: ["RESOLVED", "FALSE_ALARM", "ARCHIVED"] } },
              orderBy: { createdAt: "desc" },
              take: 5,
              select: {
                id: true,
                state: true,
                triggerType: true,
                contactStatus: true,
                createdAt: true,
                lastLatitude: true,
                lastLongitude: true,
              },
            },
          },
        },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    return contacts.map((contact) => ({
      trustedContactId: contact.id,
      protectedUserId: contact.user.id,
      displayName: contact.user.displayName,
      relationship: contact.relationship,
      priority: contact.priority,
      canViewLocation: contact.canViewLocation,
      canViewEvidence: contact.canViewEvidence,
      lastAcknowledgedAt: contact.lastAcknowledgedAt?.toISOString() ?? null,
      activeIncidents: contact.user.incidents.map((incident) => ({
        ...incident,
        createdAt: incident.createdAt.toISOString(),
      })),
    }));
  }

  async responderProfile(actor: Actor) {
    if (actor.role !== "RESPONDER") throw new AppError("FORBIDDEN", 403, "Responder profile is only available to responder accounts.");
    const row = await this.prisma.responderProfile.findUnique({ where: { userId: actor.id } });
    return row ?? {
      id: null,
      userId: actor.id,
      team: null,
      region: null,
      capabilities: null,
      vehicle: null,
      phone: null,
      availability: "AVAILABLE",
    };
  }

  async updateResponderProfile(
    actor: Actor,
    input: { availability: "AVAILABLE" | "BUSY" | "OFF_DUTY" | "UNAVAILABLE"; team?: string; region?: string; capabilities?: string; vehicle?: string; phone?: string },
  ) {
    if (actor.role !== "RESPONDER") throw new AppError("FORBIDDEN", 403, "Responder profile is only available to responder accounts.");
    const now = this.clock.now();
    const row = await this.prisma.responderProfile.upsert({
      where: { userId: actor.id },
      create: {
        id: this.ids.uuid(),
        userId: actor.id,
        availability: input.availability,
        team: input.team || null,
        region: input.region || null,
        capabilities: input.capabilities || null,
        vehicle: input.vehicle || null,
        phone: input.phone || null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        availability: input.availability,
        team: input.team || null,
        region: input.region || null,
        capabilities: input.capabilities || null,
        vehicle: input.vehicle || null,
        phone: input.phone || null,
        updatedAt: now,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        id: this.ids.uuid(),
        actorId: actor.id,
        action: "responder.profile_updated",
        entityType: "ResponderProfile",
        entityId: row.id,
        correlationId: null,
        requestId: null,
        metadata: { availability: row.availability, region: row.region, capabilities: row.capabilities },
        createdAt: now,
        updatedAt: now,
      },
    });
    return row;
  }

  async listResponders(actor: Actor) {
    this.operator(actor);
    const rows = await this.prisma.user.findMany({
      where: { role: "RESPONDER" },
      select: { id: true, displayName: true, email: true },
      take: 100,
    });
    const profiles = await this.prisma.responderProfile.findMany({
      where: { userId: { in: rows.map((row) => row.id) } },
    }).catch(() => []);
    const profileByUser = new Map(profiles.map((row) => [row.userId, row]));
    const busy = await this.prisma.responderAssignment.findMany({
      where: { status: { notIn: ["COMPLETED", "DECLINED"] } },
      select: {
        responderId: true,
        incidentId: true,
        status: true,
        lastLatitude: true,
        lastLongitude: true,
        lastLocationAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    const busyIds = new Set(busy.map((row) => row.responderId));
    const activeByResponder = new Map<string, (typeof busy)[number]>();
    const workloadByResponder = new Map<string, number>();
    for (const assignment of busy) {
      if (!activeByResponder.has(assignment.responderId)) activeByResponder.set(assignment.responderId, assignment);
      workloadByResponder.set(assignment.responderId, (workloadByResponder.get(assignment.responderId) ?? 0) + 1);
    }
    return rows.map((row) => {
      const profile = profileByUser.get(row.id);
      const active = activeByResponder.get(row.id);
      return {
        id: row.id,
        displayName: row.displayName,
        email: row.email,
        status: busyIds.has(row.id) ? "BUSY" : profile?.availability ?? "AVAILABLE",
        team: profile?.team ?? null,
        region: profile?.region ?? null,
        capabilities: profile?.capabilities ?? null,
        vehicle: profile?.vehicle ?? null,
        phone: profile?.phone ?? null,
        latitude: active?.lastLatitude ?? null,
        longitude: active?.lastLongitude ?? null,
        locationAt: active?.lastLocationAt?.toISOString() ?? null,
        activeIncidentId: active?.incidentId ?? null,
        assignmentStatus: active?.status ?? null,
        workload: workloadByResponder.get(row.id) ?? 0,
      };
    });
  }

  async claimIncident(actor: Actor, incidentId: string, requestId: string | null) {
    this.operator(actor);
    const current = await this.prisma.incident.findUnique({ where: { id: incidentId } });
    if (!current) throw new AppError("NOT_FOUND", 404, "That incident was not found.");
    if (current.claimedBy && current.claimedBy !== actor.id) {
      throw new AppError("CONFLICT", 409, "Another operator already claimed this incident.");
    }
    const now = this.clock.now();
    await this.prisma.incident.update({
      where: { id: incidentId },
      data: { claimedBy: actor.id, claimedAt: current.claimedAt ?? now, updatedAt: now },
    });
    if (current.state === "SOS" || current.state === "CONCERN" || current.state === "HIGH_RISK") {
      return this.incidents.acknowledge(actor, incidentId, "Operator claimed this incident.", requestId);
    }
    return this.incidents.get(actor, incidentId);
  }

  async sweepUnackedSos(): Promise<void> {
    const cutoff = new Date(this.clock.now().getTime() - 30_000);
    await this.prisma.incident.updateMany({
      where: {
        state: "SOS",
        isTest: false,
        acknowledgedAt: null,
        escalatedToSupervisorAt: null,
        createdAt: { lte: cutoff },
      },
      data: { escalatedToSupervisorAt: this.clock.now() },
    });
  }

  async assign(actor: Actor, incidentId: string, responderId: string, requestId: string | null) {
    const responder = await this.users.findById(responderId);
    if (!responder || responder.role !== "RESPONDER") throw new AppError("NOT_FOUND", 404, "That responder account was not found.");
    const now = this.clock.now();
    await this.prisma.responderAssignment.upsert({
      where: { incidentId_responderId: { incidentId, responderId } },
      create: {
        id: this.ids.uuid(),
        incidentId,
        responderId,
        status: "ASSIGNED",
        assignedAt: now,
        assignedBy: actor.id,
        createdAt: now,
        updatedAt: now,
      },
      update: { status: "ASSIGNED", assignedAt: now, assignedBy: actor.id, updatedAt: now },
    });
    return this.incidents.dispatch(actor, incidentId, requestId);
  }

  async responderStatus(
    actor: Actor,
    incidentId: string,
    status: "ACCEPTED" | "EN_ROUTE" | "ON_SCENE" | "RESPONDING" | "USER_LOCATED" | "COMPLETED" | "DECLINED",
    requestId: string | null,
  ) {
    const row = await this.prisma.responderAssignment.findFirst({ where: { incidentId, responderId: actor.id } });
    if (!row) throw new AppError("FORBIDDEN", 403, "This incident is not assigned to you.");
    const now = this.clock.now();
    const mapped = normalizeResponderStatus(status);
    if (!canAdvanceResponder(row.status, mapped)) {
      throw new AppError("INVALID_TRANSITION", 409, `Cannot move a responder from ${row.status} to ${mapped}.`);
    }
    await this.prisma.responderAssignment.update({
      where: { id: row.id },
      data: {
        status: mapped,
        acceptedAt: mapped === "ACCEPTED" ? now : row.acceptedAt,
        enRouteAt: mapped === "EN_ROUTE" ? now : row.enRouteAt,
        arrivedAt: mapped === "ON_SCENE" ? now : row.arrivedAt,
        locatedAt: mapped === "USER_LOCATED" ? now : row.locatedAt,
        completedAt: mapped === "COMPLETED" ? now : row.completedAt,
        declinedAt: mapped === "DECLINED" ? now : row.declinedAt,
        updatedAt: now,
      },
    });
    if (mapped === "USER_LOCATED" || mapped === "EN_ROUTE" || mapped === "ACCEPTED" || mapped === "ON_SCENE") {
      const result = await this.incidents.responderUpdate(actor, incidentId, mapped === "USER_LOCATED" ? "USER_LOCATED" : "RESPONDING", requestId);
      void this.queueAiAssessment(incidentId).catch(() => undefined);
      return result;
    }
    return this.incidents.get(actor, incidentId);
  }

  async assigned(actor: Actor) {
    if (!hasPermission(actor.role, Permission.IncidentReadAssigned)) {
      throw new AppError("FORBIDDEN", 403, "You cannot list assigned incidents.");
    }
    const rows = await this.prisma.responderAssignment.findMany({ where: { responderId: actor.id }, select: { incidentId: true, status: true } });
    const incidents = [];
    for (const row of rows) {
      const incident = await this.prisma.incident.findUnique({
        where: { id: row.incidentId },
        include: { user: { include: { profile: true } } },
      });
      if (!incident || incident.state === "RESOLVED" || incident.state === "FALSE_ALARM" || incident.state === "ARCHIVED") continue;
      incidents.push({
        id: incident.id,
        userDisplayName: incident.user.displayName,
        triggerType: incident.triggerType,
        state: incident.state,
        isTest: incident.isTest,
        duress: incident.duress,
        contactStatus: incident.contactStatus,
        protectionMode: incident.protectionMode,
        lastLatitude: incident.lastLatitude,
        lastLongitude: incident.lastLongitude,
        lastAccuracy: incident.lastAccuracy,
        lastPositionAt: incident.lastPositionAt?.toISOString() ?? null,
        emergencyProfile: incident.user.profile ? {
          bloodType: incident.user.profile.bloodType,
          allergies: incident.user.profile.allergies,
          medications: incident.user.profile.medications,
          notes: incident.user.profile.notes,
        } : null,
        assignment: row.status,
      });
    }
    return incidents;
  }

  async position(actor: Actor, journeyId: string, latitude: number, longitude: number) {
    const result = await this.protection.notePosition(actor, journeyId, latitude, longitude);
    const incident = await this.prisma.incident.findFirst({
      where: {
        userId: actor.id,
        state: { in: ["CONCERN", "HIGH_RISK", "SOS", "ACKNOWLEDGED", "RESPONDING", "USER_LOCATED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (incident) void this.queueAiAssessment(incident.id).catch(() => undefined);
    return result;
  }

  async signals(actor: Actor, signals: string[]) {
    if (!hasPermission(actor.role, Permission.ProtectionManageOwn)) {
      throw new AppError("FORBIDDEN", 403, "You cannot submit protection signals.");
    }
    const scored = fusionEvaluate(signals);
    if (scored.level === "HIGH_RISK") await this.incidents.raiseFromFusion(actor.id, "SYSTEM_RISK_ESCALATION");
    return scored;
  }

  async profile(actor: Actor) {
    this.own(actor);
    return this.prisma.emergencyProfile.findUnique({ where: { userId: actor.id } });
  }

  async saveProfile(actor: Actor, input: { bloodType?: string; allergies?: string; medications?: string; notes?: string }) {
    this.own(actor);
    const now = this.clock.now();
    return this.prisma.emergencyProfile.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id, ...input, createdAt: now, updatedAt: now },
      update: { ...input, updatedAt: now },
    });
  }

  async exportAccount(actor: Actor) {
    this.own(actor);
    const [profile, guardians, devices, incidents] = await Promise.all([
      this.prisma.emergencyProfile.findUnique({ where: { userId: actor.id } }),
      this.prisma.trustedContact.findMany({ where: { userId: actor.id }, select: { displayName: true, phone: true, email: true } }),
      this.devices.listForUser(actor.id),
      this.prisma.incident.findMany({ where: { userId: actor.id }, select: { id: true, state: true, triggerType: true, createdAt: true, isTest: true } }),
    ]);
    return {
      profile,
      guardians,
      devices: devices.map((device) => ({ id: device.id, platform: device.platform, model: device.model })),
      incidents,
      notice: "Incident records are kept for the safety investigation. This export omits passwords, PINs, and evidence bytes.",
    };
  }

  async eraseAccount(actor: Actor, password: string) {
    this.own(actor);
    const user = await this.users.findById(actor.id);
    if (!user || !(await this.passwords.verify(password, user.passwordHash))) {
      throw new AppError("INVALID_CREDENTIALS", 401, "The password was not accepted.");
    }
    const now = this.clock.now();
    await this.prisma.trustedContact.deleteMany({ where: { userId: actor.id } });
    await this.prisma.emergencyProfile.deleteMany({ where: { userId: actor.id } });
    await this.prisma.operatorMfa.deleteMany({ where: { userId: actor.id } });
    await this.prisma.refreshToken.updateMany({ where: { userId: actor.id, revokedAt: null }, data: { revokedAt: now } });
    await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        email: `erased-${actor.id}@invalid.guardian`,
        displayName: "Erased account",
        passwordHash: await this.passwords.hash(randomBytes(24).toString("hex")),
        updatedAt: now,
      },
    });
    return { erased: true, incidentsRetained: true };
  }

  async beginMfa(actor: Actor) {
    if (!OPERATOR_ROLES.includes(actor.role)) throw new AppError("FORBIDDEN", 403, "Only monitoring accounts can enroll an authenticator.");
    const secret = generateTotpSecret();
    const now = this.clock.now();
    await this.prisma.operatorMfa.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id, secret: sealSecret(secret, this.config.jwtSecret), enabled: false, createdAt: now, updatedAt: now },
      update: { secret: sealSecret(secret, this.config.jwtSecret), enabled: false, updatedAt: now },
    });
    return { secret, otpauth: `otpauth://totp/Guardian:${encodeURIComponent(actor.displayName)}?secret=${secret}&issuer=Guardian` };
  }

  async confirmMfa(actor: Actor, code: string) {
    const row = await this.prisma.operatorMfa.findUnique({ where: { userId: actor.id } });
    if (!row || !verifyTotp(openSecret(row.secret, this.config.jwtSecret), code, this.clock.now().getTime())) {
      throw new AppError("INVALID_MFA", 401, "That authenticator code was not accepted.");
    }
    const now = this.clock.now();
    await this.prisma.operatorMfa.update({ where: { userId: actor.id }, data: { enabled: true, updatedAt: now } });
    const recoveryCodes = Array.from({ length: 10 }, () => {
      const raw = randomBytes(6).toString("hex").toUpperCase();
      return `${raw.slice(0, 6)}-${raw.slice(6)}`;
    });
    await this.prisma.$transaction([
      this.prisma.operatorMfaRecoveryCode.deleteMany({ where: { userId: actor.id } }),
      this.prisma.operatorMfaRecoveryCode.createMany({
        data: recoveryCodes.map((value) => ({
          id: randomUUID(),
          userId: actor.id,
          codeHash: hashToken(value.replace("-", "")),
          createdAt: now,
        })),
      }),
    ]);
    return { enabled: true, recoveryCodes };
  }

  async room(token: string) {
    const row = await this.prisma.incidentRoom.findUnique({
      where: { tokenHash: sha256(token) },
      include: { incident: { include: { user: true } } },
    });
    if (!row || row.expiresAt.getTime() < this.clock.now().getTime() || ["RESOLVED", "ARCHIVED", "FALSE_ALARM"].includes(row.incident.state)) {
      throw new AppError("NOT_FOUND", 404, "This incident room is closed.");
    }
    const evidence = row.canViewEvidence
      ? await this.prisma.evidenceChunk.findMany({
          where: { incidentId: row.incidentId },
          select: { sequence: true, contentType: true, byteLength: true },
        })
      : [];
    const locationAt = row.incident.lastPositionAt ?? row.incident.updatedAt;
    return {
      displayName: row.incident.user.displayName,
      state: row.incident.state,
      triggerType: row.incident.triggerType,
      location: row.canViewLocation
        ? { latitude: row.incident.lastLatitude, longitude: row.incident.lastLongitude, accuracy: row.incident.lastAccuracy }
        : null,
      lastConfirmedAt: locationAt.toISOString(),
      serverTime: this.clock.now().toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      evidence,
      notice: "This room shows the last confirmed device report, not a live track unless the time is a few seconds old.",
    };
  }

  async acknowledgeRoom(token: string) {
    const row = await this.prisma.incidentRoom.findUnique({
      where: { tokenHash: sha256(token) },
      include: { incident: { select: { state: true } } },
    });
    if (!row || row.expiresAt.getTime() < this.clock.now().getTime() || ["RESOLVED", "ARCHIVED", "FALSE_ALARM"].includes(row.incident.state)) {
      throw new AppError("NOT_FOUND", 404, "This room is closed.");
    }
    const now = this.clock.now();
    await this.prisma.incidentRoom.update({ where: { id: row.id }, data: { acknowledgedAt: now } });
    if (row.trustedContactId) {
      await this.prisma.notificationDelivery.updateMany({
        where: {
          incidentId: row.incidentId,
          trustedContactId: row.trustedContactId,
          channel: { in: ["ROOM", "SMS", "FCM", "APNS"] },
          acknowledgedAt: null,
        },
        data: { acknowledgedAt: now, status: "ACKNOWLEDGED" },
      });
    }
    if (row.trustedContactId) {
      await this.prisma.trustedContact.updateMany({
        where: { id: row.trustedContactId, user: { incidents: { some: { id: row.incidentId } } } },
        data: { lastAcknowledgedAt: now },
      });
    }
    await this.record(
      row.incidentId,
      "ROOM_ACK",
      row.guardianName ?? "guardian",
      "ACKNOWLEDGED",
      "A guardian opened and acknowledged the room.",
      undefined,
      row.trustedContactId ?? undefined,
    );
    void this.queueAiAssessment(row.incidentId).catch(() => undefined);
    return { acknowledgedAt: now.toISOString() };
  }

  async acknowledgeDelivery(actor: Actor, deliveryId: string) {
    const row = await this.prisma.notificationDelivery.findUnique({ where: { id: deliveryId } });
    if (!row) throw new AppError("NOT_FOUND", 404, "That delivery was not found.");
    const incident = await this.prisma.incident.findUnique({ where: { id: row.incidentId } });
    if (!incident) throw new AppError("NOT_FOUND", 404, "That incident was not found.");
    const guardian = row.trustedContactId
      ? await this.prisma.trustedContact.findFirst({
          where: {
            id: row.trustedContactId,
            userId: incident.userId,
            guardianUserId: actor.id,
            invitationStatus: "ACCEPTED",
            active: true,
          },
        })
      : null;
    const isOwner = incident.userId === actor.id;
    const isOperator = hasPermission(actor.role, Permission.IncidentReadActive);
    if (!guardian && !isOwner && !isOperator) {
      throw new AppError("FORBIDDEN", 403, "You cannot acknowledge this delivery.");
    }
    const now = this.clock.now();
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { acknowledgedAt: now, status: "ACKNOWLEDGED" },
    });
    if (guardian) {
      await this.prisma.trustedContact.update({ where: { id: guardian.id }, data: { lastAcknowledgedAt: now } });
    }
    void this.queueAiAssessment(row.incidentId).catch(() => undefined);
    return { acknowledgedAt: now.toISOString() };
  }

  async updateResponderLocation(actor: Actor, incidentId: string, latitude: number, longitude: number, speedMps?: number) {
    const row = await this.prisma.responderAssignment.findFirst({ where: { incidentId, responderId: actor.id } });
    if (!row) throw new AppError("FORBIDDEN", 403, "This incident is not assigned to you.");
    const now = this.clock.now();
    await this.prisma.responderAssignment.update({
      where: { id: row.id },
      data: {
        lastLatitude: latitude,
        lastLongitude: longitude,
        lastLocationAt: now,
        speedMps: speedMps ?? row.speedMps,
        updatedAt: now,
      },
    });
    void this.queueAiAssessment(incidentId).catch(() => undefined);
    return this.liveCompanion(actor, incidentId);
  }

  async listOperators(actor: Actor) {
    this.operator(actor);
    const rows = await this.prisma.user.findMany({
      where: { role: { in: ["MONITOR_OPERATOR", "SUPERVISOR", "ADMIN"] } },
      select: { id: true, displayName: true, email: true, role: true },
      orderBy: { displayName: "asc" },
      take: 200,
    });
    const shifts = await this.prisma.operatorShift.findMany({
      where: { operatorId: { in: rows.map((row) => row.id) }, status: { in: ["READY", "ON_DUTY", "HANDOVER"] } },
      orderBy: { startedAt: "desc" },
    });
    const current = new Map<string, (typeof shifts)[number]>();
    for (const shift of shifts) if (!current.has(shift.operatorId)) current.set(shift.operatorId, shift);
    return rows.map((row) => ({
      ...row,
      shiftStatus: current.get(row.id)?.status ?? "OFF_DUTY",
      shiftStartedAt: current.get(row.id)?.startedAt.toISOString() ?? null,
    }));
  }

  async startShift(actor: Actor) {
    this.operator(actor);
    const open = await this.prisma.operatorShift.findFirst({
      where: { operatorId: actor.id, status: { in: ["READY", "ON_DUTY", "HANDOVER"] } },
    });
    if (open) return open;
    const now = this.clock.now();
    return this.prisma.operatorShift.create({
      data: {
        id: this.ids.uuid(),
        operatorId: actor.id,
        status: "ON_DUTY",
        startedAt: now,
        readyAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async markShiftReady(actor: Actor) {
    this.operator(actor);
    const open = await this.prisma.operatorShift.findFirst({
      where: { operatorId: actor.id, status: { in: ["ON_DUTY", "READY", "HANDOVER"] } },
      orderBy: { startedAt: "desc" },
    });
    if (!open) throw new AppError("NOT_FOUND", 404, "Start a shift before marking ready.");
    const now = this.clock.now();
    return this.prisma.operatorShift.update({
      where: { id: open.id },
      data: { status: "READY", readyAt: now, updatedAt: now },
    });
  }

  async handoverShift(actor: Actor, note: string, handoverToId?: string) {
    this.operator(actor);
    const open = await this.prisma.operatorShift.findFirst({
      where: { operatorId: actor.id, status: { in: ["ON_DUTY", "READY", "HANDOVER"] } },
      orderBy: { startedAt: "desc" },
    });
    if (!open) throw new AppError("NOT_FOUND", 404, "There is no open shift to hand over.");
    const now = this.clock.now();
    const ended = await this.prisma.operatorShift.update({
      where: { id: open.id },
      data: {
        status: "ENDED",
        handoverNote: note.slice(0, 2000),
        handoverToId: handoverToId ?? null,
        endedAt: now,
        updatedAt: now,
      },
    });
    if (handoverToId) {
      await this.prisma.operatorShift.create({
        data: {
          id: this.ids.uuid(),
          operatorId: handoverToId,
          status: "HANDOVER",
          startedAt: now,
          handoverNote: `Received from ${actor.displayName}: ${note.slice(0, 500)}`,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    return ended;
  }

  async currentShift(actor: Actor) {
    this.operator(actor);
    return this.prisma.operatorShift.findFirst({
      where: { operatorId: actor.id, status: { in: ["READY", "ON_DUTY", "HANDOVER"] } },
      orderBy: { startedAt: "desc" },
    });
  }

  async processOutboxBatch(workerId: string): Promise<{ processed: number; dead: number }> {
    if (!this.outbox) return { processed: 0, dead: 0 };
    const batch = await this.outbox.claimBatch(workerId);
    let processed = 0;
    let dead = 0;
    for (const event of batch) {
      try {
        if (event.type === "INCIDENT_GUARDIAN_NOTIFY") {
          const payload = event.payload as { incidentId: string; userId: string; userDisplayName: string; state: string };
          await this.dispatchGuardianNotify(payload);
        } else if (event.type === "AI_ASSESS") {
          const payload = event.payload as { incidentId?: string };
          if (!this.ai || !payload.incidentId) throw new Error("AI assessment needs an incident id.");
          await this.ai.assess(payload.incidentId);
        } else {
          throw new Error(`Unknown outbox type ${event.type}`);
        }
        await this.outbox.markSent(event.id);
        processed += 1;
      } catch (error) {
        const outcome = await this.outbox.markFailure(
          event.id,
          error instanceof Error ? error.message : "unknown",
          event.attempts,
          event.maxAttempts,
          event.type,
          event.aggregateType,
          event.aggregateId,
          event.payload,
        );
        if (outcome === "dead") dead += 1;
      }
    }
    return { processed, dead };
  }

  private async openRoom(
    incidentId: string,
    canViewLocation: boolean,
    canViewEvidence: boolean,
    trustedContactId?: string,
    guardianName?: string,
  ): Promise<{ url: string }> {
    const token = randomBytes(32).toString("base64url");
    const now = this.clock.now();
    await this.prisma.incidentRoom.create({
      data: {
        id: this.ids.uuid(),
        incidentId,
        tokenHash: sha256(token),
        guardianName: guardianName ?? null,
        trustedContactId: trustedContactId ?? null,
        canViewLocation,
        canViewEvidence,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        createdAt: now,
      },
    });
    const origin = this.config.corsOrigins[0] ?? "http://localhost:5173";
    return { url: `${origin}/room/${token}` };
  }

  async applyDeliveryReceipt(input: {
    providerMessageId: string;
    channel: string;
    status: "SENT" | "DELIVERED" | "FAILED";
    detail: string;
    failureCode?: string;
  }): Promise<void> {
    const now = this.clock.now();
    try {
      await this.prisma.notificationDelivery.updateMany({
        where: { providerMessageId: input.providerMessageId, channel: input.channel },
        data: {
          status: input.status,
          detail: input.detail,
          deliveredAt: input.status === "DELIVERED" ? now : undefined,
          failedAt: input.status === "FAILED" ? now : undefined,
          failureCode: input.failureCode,
          sentAt: input.status === "SENT" ? now : undefined,
        },
      });
    } catch {
      // A receipt for an unknown message, or a process without Postgres, is not a crash.
    }
  }

  private async record(
    incidentId: string,
    channel: string,
    destination: string,
    status: string,
    detail: string,
    providerMessageId?: string,
    trustedContactId?: string,
  ): Promise<void> {
    const now = this.clock.now();
    await this.prisma.notificationDelivery.create({
      data: {
        id: this.ids.uuid(),
        incidentId,
        channel,
        destination,
        status,
        detail,
        providerMessageId,
        trustedContactId: trustedContactId ?? null,
        queuedAt: now,
        sentAt: status === "SENT" || status === "ACKNOWLEDGED" ? now : null,
        acknowledgedAt: status === "ACKNOWLEDGED" ? now : null,
        createdAt: now,
      },
    });
    if (trustedContactId) {
      await this.prisma.trustedContact.update({
        where: { id: trustedContactId },
        data: { lastNotifiedAt: now },
      }).catch(() => undefined);
    }
  }

  async listUsers(actor: Actor) {
    if (!hasPermission(actor.role, Permission.UserManage)) {
      throw new AppError("FORBIDDEN", 403, "You cannot manage accounts.");
    }
    const rows = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true,
        suspendedAt: true,
        lastLoginAt: true,
        mfa: { select: { enabled: true } },
        _count: { select: { devices: true, refreshTokens: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      mfaEnabled: row.mfa?.enabled === true,
      deviceCount: row._count.devices,
      sessionCount: row._count.refreshTokens,
    }));
  }

  private async manageableUser(actor: Actor, userId: string) {
    if (!hasPermission(actor.role, Permission.UserManage)) throw new AppError("FORBIDDEN", 403, "You cannot manage accounts.");
    if (actor.id === userId) throw new AppError("FORBIDDEN", 403, "Use your own security page for self-service changes.");
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new AppError("NOT_FOUND", 404, "That account was not found.");
    if (target.role === "ADMIN" && actor.role !== "ADMIN") throw new AppError("FORBIDDEN", 403, "A supervisor cannot manage an administrator.");
    return target;
  }

  private async auditAdmin(actor: Actor, action: string, entityId: string, metadata: Record<string, unknown> = {}) {
    const now = this.clock.now();
    await this.prisma.auditEvent.create({
      data: {
        id: this.ids.uuid(),
        actorId: actor.id,
        action,
        entityType: "User",
        entityId,
        correlationId: null,
        requestId: null,
        metadata: metadata as Prisma.InputJsonValue,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async userDetail(actor: Actor, userId: string) {
    if (!hasPermission(actor.role, Permission.UserManage)) throw new AppError("FORBIDDEN", 403, "You cannot manage accounts.");
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        devices: { orderBy: { lastSeenAt: "desc" }, take: 50 },
        refreshTokens: { orderBy: { createdAt: "desc" }, take: 50 },
        mfa: true,
        mfaRecoveryCodes: { select: { usedAt: true } },
      },
    });
    if (!row) throw new AppError("NOT_FOUND", 404, "That account was not found.");
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
      mfaEnabled: row.mfa?.enabled === true,
      unusedMfaRecoveryCodes: row.mfaRecoveryCodes.filter((code) => !code.usedAt).length,
      devices: row.devices.map((device) => ({
        id: device.id,
        nickname: device.nickname,
        model: device.model,
        platform: device.platform,
        osVersion: device.osVersion,
        appVersion: device.appVersion,
        revokedAt: device.revokedAt?.toISOString() ?? null,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        pushReady: Boolean(device.fcmToken),
        emergencyCredentialProvisioned: Boolean(device.emergencyTokenHash),
      })),
      sessions: row.refreshTokens.map((token) => ({
        id: token.id,
        familyId: token.familyId,
        createdAt: token.createdAt.toISOString(),
        expiresAt: token.expiresAt.toISOString(),
        revokedAt: token.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  async suspendUser(actor: Actor, userId: string, suspended: boolean) {
    const target = await this.manageableUser(actor, userId);
    const now = this.clock.now();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { suspendedAt: suspended ? now : null, updatedAt: now } }),
      ...(suspended
        ? [this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, updatedAt: now } })]
        : []),
    ]);
    await this.auditAdmin(actor, suspended ? "user.suspended" : "user.reactivated", userId, { previousRole: target.role });
    return { id: userId, suspendedAt: suspended ? now.toISOString() : null };
  }

  async revokeUserSessions(actor: Actor, userId: string) {
    await this.manageableUser(actor, userId);
    const now = this.clock.now();
    const result = await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, updatedAt: now } });
    await this.auditAdmin(actor, "user.sessions_revoked", userId, { count: result.count });
    return { id: userId, revoked: result.count };
  }

  async resetUserMfa(actor: Actor, userId: string) {
    await this.manageableUser(actor, userId);
    const result = await this.prisma.$transaction([
      this.prisma.operatorMfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.operatorMfa.deleteMany({ where: { userId } }),
    ]);
    await this.auditAdmin(actor, "user.mfa_reset", userId);
    return { id: userId, reset: true, deletedRecoveryCodes: result[0].count };
  }

  async setRole(actor: Actor, userId: string, role: Role) {
    const reason = canAssignRole(actor.role, role, actor.id === userId);
    if (reason) throw new AppError("FORBIDDEN", 403, reason);
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!existing) throw new AppError("NOT_FOUND", 404, "That account was not found.");
    if (existing.role === "ADMIN" && actor.role !== "ADMIN") {
      throw new AppError("FORBIDDEN", 403, "A supervisor cannot change an administrator.");
    }
    await this.prisma.user.update({ where: { id: userId }, data: { role } });
    return { id: userId, role };
  }

  private demoConfig() {
    if (process.env.GUARDIAN_DEMO_MODE !== "true") {
      throw new AppError("NOT_AVAILABLE", 404, "Competition Demo Mode is disabled.");
    }
    const password = process.env.GUARDIAN_DEMO_PASSWORD ?? "";
    if (password.length < 12) {
      throw new AppError("NOT_CONFIGURED", 503, "GUARDIAN_DEMO_PASSWORD must be at least 12 characters.");
    }
    return {
      password,
      userId: "00000000-0000-4000-8000-000000000101",
      guardianId: "00000000-0000-4000-8000-000000000102",
      responderId: "00000000-0000-4000-8000-000000000103",
      deviceId: "00000000-0000-4000-8000-000000000201",
      devicePublicId: "00000000-0000-4000-8000-000000000202",
      contactId: "00000000-0000-4000-8000-000000000301",
    };
  }

  async demoStatus(actor: Actor) {
    if (!hasPermission(actor.role, Permission.UserManage)) throw new AppError("FORBIDDEN", 403, "Demo controls require supervisor or administrator access.");
    const cfg = this.demoConfig();
    const incident = await this.prisma.incident.findFirst({
      where: { userId: cfg.userId, isTest: true },
      orderBy: { createdAt: "desc" },
      include: { timeline: { where: { type: { startsWith: "demo.stage." } }, orderBy: { occurredAt: "desc" }, take: 1 } },
    });
    return {
      enabled: true,
      accounts: {
        protectedUser: "demo.user@demo.guardian.app",
        guardian: "demo.guardian@demo.guardian.app",
        responder: "demo.responder@demo.guardian.app",
      },
      incidentId: incident?.id ?? null,
      state: incident?.state ?? null,
      stage: incident?.timeline[0]?.type ?? null,
    };
  }

  async resetDemo(actor: Actor) {
    if (!hasPermission(actor.role, Permission.UserManage)) throw new AppError("FORBIDDEN", 403, "Demo controls require supervisor or administrator access.");
    const cfg = this.demoConfig();
    const now = this.clock.now();
    const passwordHash = await this.passwords.hash(cfg.password);
    const accounts = [
      { id: cfg.userId, email: "demo.user@demo.guardian.app", displayName: "Thandi Demo", role: "USER" as const },
      { id: cfg.guardianId, email: "demo.guardian@demo.guardian.app", displayName: "Lerato Guardian", role: "GUARDIAN" as const },
      { id: cfg.responderId, email: "demo.responder@demo.guardian.app", displayName: "Unit 04 Demo", role: "RESPONDER" as const },
    ];
    for (const account of accounts) {
      await this.prisma.user.upsert({
        where: { email: account.email },
        create: { ...account, passwordHash, emailVerifiedAt: now },
        update: { displayName: account.displayName, role: account.role, passwordHash, emailVerifiedAt: now },
      });
    }
    await this.prisma.incident.deleteMany({ where: { userId: cfg.userId, isTest: true } });
    await this.prisma.device.upsert({
      where: { userId_devicePublicId: { userId: cfg.userId, devicePublicId: cfg.devicePublicId } },
      create: {
        id: cfg.deviceId,
        userId: cfg.userId,
        devicePublicId: cfg.devicePublicId,
        platform: "ANDROID",
        manufacturer: "Guardian Demo",
        model: "Competition handset",
        osVersion: "Android 15",
        appVersion: "demo",
        nickname: "Demo phone",
        lastSeenAt: now,
      },
      update: { revokedAt: null, lastSeenAt: now, nickname: "Demo phone" },
    });
    await this.prisma.trustedContact.upsert({
      where: { id: cfg.contactId },
      create: {
        id: cfg.contactId,
        userId: cfg.userId,
        displayName: "Lerato Guardian",
        email: "demo.guardian@demo.guardian.app",
        canViewLocation: true,
        canViewEvidence: true,
        relationship: "FAMILY",
        priority: 1,
        notificationMethods: "PUSH,SMS",
        guardianUserId: cfg.guardianId,
        invitationStatus: "ACCEPTED",
        verifiedAt: now,
        active: true,
      },
      update: {
        guardianUserId: cfg.guardianId,
        invitationStatus: "ACCEPTED",
        verifiedAt: now,
        active: true,
        canViewLocation: true,
        canViewEvidence: true,
      },
    });
    await this.prisma.responderProfile.upsert({
      where: { userId: cfg.responderId },
      create: {
        id: this.ids.uuid(),
        userId: cfg.responderId,
        team: "Competition Response",
        region: "Demo Zone",
        capabilities: "FIRST_AID,SEARCH,VEHICLE_RESPONSE",
        vehicle: "Response Unit 04",
        phone: "+27000000004",
        availability: "AVAILABLE",
      },
      update: { availability: "AVAILABLE", team: "Competition Response", region: "Demo Zone", capabilities: "FIRST_AID,SEARCH,VEHICLE_RESPONSE", vehicle: "Response Unit 04" },
    });
    const incidentId = this.ids.uuid();
    const triggerId = this.ids.uuid();
    const correlationId = this.ids.uuid();
    const latitude = -28.7383;
    const longitude = 24.7636;
    const capsule = {
      timestamp: now.toISOString(),
      latitude,
      longitude,
      locationAccuracy: 8,
      speed: 16,
      heading: 210,
      batteryLevel: 68,
      chargingStatus: false,
      networkType: "LTE",
      protectionMode: "DRIVE",
      duress: false,
      lastKnownLocation: { latitude, longitude, recordedAt: now.toISOString() },
      appProtectionStatus: "PROTECTED",
    };
    await this.prisma.incident.create({
      data: {
        id: incidentId,
        userId: cfg.userId,
        deviceId: cfg.deviceId,
        triggerId,
        triggerType: "VOLUME_BUTTON",
        requestHash: sha256(`demo:${triggerId}`),
        state: "SOS",
        isTest: true,
        duress: false,
        correlationId,
        protectionMode: "DRIVE",
        contactStatus: "ONLINE",
        capsuleJson: capsule,
        lastHeartbeatAt: now,
        lastPositionAt: now,
        lastLatitude: latitude,
        lastLongitude: longitude,
        lastAccuracy: 8,
        lastSpeed: 16,
        lastHeading: 210,
        lastBattery: 68,
        createdAt: now,
        updatedAt: now,
      },
    });
    await this.prisma.incidentLocation.create({
      data: {
        id: this.ids.uuid(),
        incidentId,
        clientPointId: this.ids.uuid(),
        latitude,
        longitude,
        accuracy: 8,
        speed: 16,
        bearing: 210,
        altitude: null,
        source: "DEMO",
        recordedAt: now,
      },
    });
    await this.prisma.timelineEvent.createMany({
      data: [
        { id: this.ids.uuid(), incidentId, type: "trigger.received", message: "TEST volume-button SOS triggered for the competition scenario.", occurredAt: now, actorId: cfg.userId },
        { id: this.ids.uuid(), incidentId, type: "demo.stage.0", message: "Demo reset: protected journey SOS is active.", occurredAt: now, actorId: actor.id },
      ],
    });
    await this.prisma.notificationDelivery.create({
      data: {
        id: this.ids.uuid(),
        incidentId,
        trustedContactId: cfg.contactId,
        channel: "ROOM",
        destination: "Lerato Guardian",
        status: "SENT",
        detail: "TEST private Guardian Room created. No external message was transmitted.",
        queuedAt: now,
        sentAt: now,
      },
    });
    if (this.ai) await this.ai.assess(incidentId).catch(() => undefined);
    return this.demoStatus(actor);
  }

  async advanceDemo(actor: Actor) {
    if (!hasPermission(actor.role, Permission.UserManage)) throw new AppError("FORBIDDEN", 403, "Demo controls require supervisor or administrator access.");
    const cfg = this.demoConfig();
    const incident = await this.prisma.incident.findFirst({
      where: { userId: cfg.userId, isTest: true },
      orderBy: { createdAt: "desc" },
      include: { timeline: { where: { type: { startsWith: "demo.stage." } }, orderBy: { occurredAt: "desc" }, take: 1 } },
    });
    if (!incident) throw new AppError("NOT_FOUND", 404, "Reset the demo scenario first.");
    const currentStage = Number(incident.timeline[0]?.type.split(".").pop() ?? "0");
    const stage = Math.min(5, currentStage + 1);
    const now = this.clock.now();
    if (stage === 1) {
      const latitude = (incident.lastLatitude ?? -28.7383) - 0.009;
      const longitude = (incident.lastLongitude ?? 24.7636) - 0.007;
      await this.prisma.incident.update({
        where: { id: incident.id },
        data: {
          contactStatus: "DEVICE_CONTACT_LOST",
          contactLostAt: now,
          lastLatitude: latitude,
          lastLongitude: longitude,
          lastPositionAt: now,
          updatedAt: now,
        },
      });
      await this.prisma.incidentLocation.create({
        data: { id: this.ids.uuid(), incidentId: incident.id, clientPointId: this.ids.uuid(), latitude, longitude, accuracy: 12, speed: 18, bearing: 215, altitude: null, source: "DEMO", recordedAt: now },
      });
      await this.prisma.timelineEvent.create({ data: { id: this.ids.uuid(), incidentId: incident.id, type: "device.contact_lost", message: "TEST device contact lost after route deviation.", occurredAt: now } });
    } else if (stage === 2) {
      await this.prisma.incident.update({ where: { id: incident.id }, data: { state: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedById: actor.id, updatedAt: now } });
      await this.prisma.notificationDelivery.updateMany({ where: { incidentId: incident.id, trustedContactId: cfg.contactId }, data: { status: "ACKNOWLEDGED", acknowledgedAt: now } });
      await this.prisma.trustedContact.update({ where: { id: cfg.contactId }, data: { lastAcknowledgedAt: now } });
      await this.prisma.timelineEvent.create({ data: { id: this.ids.uuid(), incidentId: incident.id, type: "guardian.acknowledged", message: "TEST Guardian acknowledged the alert.", occurredAt: now, actorId: cfg.guardianId } });
    } else if (stage === 3) {
      await this.prisma.incident.update({ where: { id: incident.id }, data: { state: "RESPONDING", updatedAt: now } });
      await this.prisma.responderAssignment.upsert({
        where: { incidentId_responderId: { incidentId: incident.id, responderId: cfg.responderId } },
        create: { id: this.ids.uuid(), incidentId: incident.id, responderId: cfg.responderId, status: "EN_ROUTE", assignedAt: now, acceptedAt: now, enRouteAt: now, assignedBy: actor.id, lastLatitude: -28.7305, lastLongitude: 24.771, lastLocationAt: now, speedMps: 14 },
        update: { status: "EN_ROUTE", assignedAt: now, acceptedAt: now, enRouteAt: now, assignedBy: actor.id, lastLatitude: -28.7305, lastLongitude: 24.771, lastLocationAt: now, speedMps: 14 },
      });
      await this.prisma.timelineEvent.create({ data: { id: this.ids.uuid(), incidentId: incident.id, type: "responder.dispatched", message: "TEST Unit 04 dispatched and en route.", occurredAt: now, actorId: actor.id } });
    } else if (stage === 4) {
      await this.prisma.incident.update({ where: { id: incident.id }, data: { state: "USER_LOCATED", updatedAt: now } });
      await this.prisma.responderAssignment.update({
        where: { incidentId_responderId: { incidentId: incident.id, responderId: cfg.responderId } },
        data: { status: "USER_LOCATED", arrivedAt: now, locatedAt: now, lastLatitude: incident.lastLatitude, lastLongitude: incident.lastLongitude, lastLocationAt: now },
      });
      await this.prisma.timelineEvent.create({ data: { id: this.ids.uuid(), incidentId: incident.id, type: "responder.user_located", message: "TEST responder reported the protected person located.", occurredAt: now, actorId: cfg.responderId } });
    } else if (stage === 5) {
      await this.prisma.incident.update({ where: { id: incident.id }, data: { state: "RESOLVED", resolvedAt: now, resolvedById: actor.id, updatedAt: now } });
      await this.prisma.responderAssignment.updateMany({ where: { incidentId: incident.id }, data: { status: "COMPLETED", completedAt: now } });
      await this.prisma.timelineEvent.create({ data: { id: this.ids.uuid(), incidentId: incident.id, type: "incident.resolved", message: "TEST scenario resolved.", occurredAt: now, actorId: actor.id } });
    }
    await this.prisma.timelineEvent.create({ data: { id: this.ids.uuid(), incidentId: incident.id, type: `demo.stage.${stage}`, message: `Competition demo advanced to stage ${stage}.`, occurredAt: now, actorId: actor.id } });
    if (this.ai) await this.ai.assess(incident.id).catch(() => undefined);
    return this.demoStatus(actor);
  }

  async integrationTest(actor: Actor, kind: string) {
    if (!hasPermission(actor.role, Permission.UserManage)) {
      throw new AppError("FORBIDDEN", 403, "Only supervisors or administrators can run integration tests.");
    }
    const upper = kind.trim().toUpperCase();
    if (upper === "DATABASE") {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        return { kind: upper, ok: true, detail: "PostgreSQL query succeeded." };
      } catch (error) {
        return { kind: upper, ok: false, detail: error instanceof Error ? error.message : "PostgreSQL probe failed." };
      }
    }
    if (upper === "REDIS") {
      const state = this.redis ? await this.redis.ping() : "unconfigured";
      return { kind: upper, ok: state === "up", detail: `Redis ${state}.` };
    }
    if (upper === "WEBSOCKET") {
      const state = websocketStatus();
      return { kind: upper, ok: state.includes("up") || state === "single-process", detail: state };
    }
    if (upper === "EVIDENCE") {
      const result = await this.vault.probeLocal();
      return { kind: upper, ...result };
    }
    if (upper === "SMS") {
      const to = process.env.INTEGRATION_TEST_PHONE?.trim();
      if (!to) return { kind: upper, ok: false, detail: "Set INTEGRATION_TEST_PHONE before sending a test SMS." };
      const result = await this.sms.send({ to, body: "Guardian integration test. No emergency is active.", incidentId: "integration-test" });
      return { kind: upper, ok: result.delivered, detail: result.reason };
    }
    if (upper === "PUSH") {
      const token = process.env.INTEGRATION_TEST_FCM_TOKEN?.trim();
      if (!token) return { kind: upper, ok: false, detail: "Set INTEGRATION_TEST_FCM_TOKEN before sending a test push." };
      const result = await sendFcm(token, "Guardian test", "Integration test. No emergency is active.", process.env, { type: "INTEGRATION_TEST" });
      return { kind: upper, ok: result.delivered, detail: result.reason };
    }
    if (upper === "EMAIL") {
      const to = process.env.INTEGRATION_TEST_EMAIL?.trim();
      if (!to) return { kind: upper, ok: false, detail: "Set INTEGRATION_TEST_EMAIL before sending a test email." };
      try {
        const sent = await sendTransactionalEmail({ to, subject: "Guardian integration test", text: "Guardian integration test. No emergency is active." });
        return { kind: upper, ok: sent, detail: sent ? "SMTP accepted the test email." : "SMTP is not configured." };
      } catch (error) {
        return { kind: upper, ok: false, detail: error instanceof Error ? error.message : "SMTP test failed." };
      }
    }
    if (upper === "MAPS") {
      const query = process.env.INTEGRATION_TEST_GEOCODE_QUERY?.trim() || "Kimberley, South Africa";
      const result = await geocodeDestination(query).catch(() => null);
      return { kind: upper, ok: Boolean(result), detail: result ? `Geocoding returned ${result.label}.` : "Geocoding did not return a result." };
    }
    throw new AppError("VALIDATION", 422, "Unknown integration test.");
  }

  async recoverDeadLetter(actor: Actor, id: string, action: "RETRY" | "RESOLVE") {
    if (!hasPermission(actor.role, Permission.UserManage)) {
      throw new AppError("FORBIDDEN", 403, "Only supervisors or administrators can change dead-letter state.");
    }
    if (!this.outbox) throw new AppError("NOT_CONFIGURED", 503, "The durable outbox is not configured.");
    const changed = action === "RETRY"
      ? await this.outbox.requeueDeadLetter(id)
      : await this.outbox.resolveDeadLetter(id);
    if (!changed) throw new AppError("NOT_FOUND", 404, "That dead letter was not found.");
    const now = this.clock.now();
    await this.prisma.auditEvent.create({
      data: {
        id: this.ids.uuid(),
        actorId: actor.id,
        action: action === "RETRY" ? "outbox.dead_letter_requeued" : "outbox.dead_letter_resolved",
        entityType: "OutboxDeadLetter",
        entityId: id,
        correlationId: null,
        requestId: null,
        metadata: { action },
        createdAt: now,
        updatedAt: now,
      },
    });
    return { id, action, changed: true };
  }

  async platformStatus(actor: Actor) {
    if (!hasPermission(actor.role, Permission.PlatformRead)) {
      throw new AppError("FORBIDDEN", 403, "You cannot view platform status.");
    }
    let postgres: "up" | "down" = "down";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = "up";
    } catch {
      postgres = "down";
    }
    return {
      postgres,
      sms: smsHealth(),
      fcm: fcmHealth(),
      apns: apnsHealth(),
      s3: s3Configured() ? "CONFIGURED" : "NOT_CONFIGURED",
      vault: process.env.EVIDENCE_VAULT_KEY ? "independent-aes-gcm" : "dev-jwt-fallback",
      requests: requestMetrics.total,
      serverErrors: requestMetrics.serverErrors,
      smsConfigured: smsHealth() === "CONFIGURED",
      fcmConfigured: fcmHealth() === "CONFIGURED",
      apnsConfigured: apnsHealth() === "CONFIGURED",
      s3Configured: s3Configured(),
      redis: this.redis ? await this.redis.ping() : process.env.REDIS_URL?.trim() ? "down" : "unconfigured",
      websocket: websocketStatus(),
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.npm_package_version ?? "unknown",
      gitCommit: process.env.GIT_COMMIT ?? process.env.SOURCE_VERSION ?? "unknown",
      evidenceQueue: this.outbox ? "durable-outbox" : "in-process",
      notificationBacklog: this.outbox ? await this.outbox.backlog() : "in-process-fallback",
      deadLetters: this.outbox ? await this.outbox.recentDead() : [],
      ai: this.ai ? await this.ai.counts() : null,
      lastBackup: await latestEncryptedBackup(process.env.BACKUP_STATUS_DIR),
    };
  }

  async emergencyHandoff(actor: Actor, incidentId: string, requestId: string | null) {
    return this.incidents.noteEmergencyServices(actor, incidentId, requestId);
  }

  private operator(actor: Actor): void {
    if (!hasPermission(actor.role, Permission.IncidentReadActive)) {
      throw new AppError("FORBIDDEN", 403, "You cannot view monitoring detail.");
    }
  }

  private own(actor: Actor): void {
    if (!hasPermission(actor.role, Permission.UserReadSelf) && !hasPermission(actor.role, Permission.ProtectionManageOwn)) {
      throw new AppError("FORBIDDEN", 403, "You cannot change this account.");
    }
  }
}

export class PrismaMfaStore implements MfaStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly keyMaterial: string,
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    try {
      const row = await this.prisma.operatorMfa.findUnique({ where: { userId } });
      return row?.enabled === true;
    } catch {
      return false;
    }
  }

  async secret(userId: string): Promise<string | null> {
    try {
      const row = await this.prisma.operatorMfa.findUnique({ where: { userId } });
      return row?.secret ? openSecret(row.secret, this.keyMaterial) : null;
    } catch {
      return null;
    }
  }

  async prepareEnrollment(userId: string, secret: string): Promise<void> {
    const now = new Date();
    const sealed = sealSecret(secret, this.keyMaterial);
    await this.prisma.$transaction([
      this.prisma.operatorMfa.upsert({
        where: { userId },
        create: { userId, secret: sealed, enabled: false, createdAt: now, updatedAt: now },
        update: { secret: sealed, enabled: false, updatedAt: now },
      }),
      this.prisma.operatorMfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  async enable(userId: string): Promise<void> {
    await this.prisma.operatorMfa.updateMany({ where: { userId }, data: { enabled: true, updatedAt: new Date() } });
  }

  async replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.operatorMfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.operatorMfaRecoveryCode.createMany({
        data: codeHashes.map((codeHash) => ({ id: randomUUID(), userId, codeHash, createdAt: now })),
      }),
    ]);
  }

  async consumeRecoveryCode(userId: string, codeHash: string, now: Date): Promise<boolean> {
    const row = await this.prisma.operatorMfaRecoveryCode.findFirst({ where: { userId, codeHash, usedAt: null } });
    if (!row) return false;
    const updated = await this.prisma.operatorMfaRecoveryCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    return updated.count === 1;
  }
}
