import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
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
import { sha256 } from "./security";
import { apnsHealth, fcmHealth, sendApns, sendFcm, smsHealth, TwilioSmsProvider } from "./sms";
import { requestMetrics } from "../common/http";
import type { MfaStore } from "./auth-service";
import type { OutboxService } from "./outbox";
import { etaSeconds } from "./scheduler-lock";

const OPERATOR_ROLES: Role[] = ["MONITOR_OPERATOR", "SUPERVISOR", "RESPONDER", "ADMIN"];

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
  ) {}

  async notifyIncident(incident: { id: string; userId: string; userDisplayName: string; state: string; isTest: boolean }): Promise<void> {
    if (incident.isTest) return;
    if (this.outbox) {
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
      return;
    }
    await this.dispatchGuardianNotify(incident);
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
      const room = await this.openRoom(incidentId, contact.canViewLocation, contact.canViewEvidence, contact.displayName);
      const body = guardianSmsBody({
        name: incident.userDisplayName,
        incidentState: incident.state,
        roomUrl: room.url,
      });
      if (methods.includes("SMS")) {
        const sms = contact.phone
          ? await this.sms.send({ to: contact.phone, body, incidentId })
          : { delivered: false, simulated: true, reason: "This guardian has no phone number.", providerMessageId: undefined };
        await this.record(incidentId, "SMS", contact.phone ?? contact.email ?? contact.displayName, sms.delivered ? "SENT" : "SKIPPED", sms.reason, sms.providerMessageId);
      }
      await this.record(incidentId, "ROOM", contact.displayName, "SENT", "A private room link was created for this guardian.", undefined, contact.id);
      if (methods.includes("PUSH") && contact.guardianUserId) {
        const guardianPhones = await this.prisma.device.findMany({
          where: { userId: contact.guardianUserId, fcmToken: { not: null }, revokedAt: null },
        });
        for (const phone of guardianPhones) {
          if (!phone.fcmToken) continue;
          const apple = phone.platform === "IOS";
          const push = apple
            ? await sendApns(phone.fcmToken, "Guardian", `${incident.userDisplayName} needs help.`)
            : await sendFcm(phone.fcmToken, "Guardian", `${incident.userDisplayName} needs help.`);
          await this.record(incidentId, apple ? "APNS" : "FCM", contact.displayName, push.delivered ? "SENT" : "SKIPPED", push.reason, push.providerMessageId);
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
      where: { status: { in: ["ASSIGNED", "RESPONDING"] } },
      select: { responderId: true, incidentId: true },
    });
    const busyIds = new Set(busy.map((row) => row.responderId));
    return rows.map((row) => {
      const profile = profileByUser.get(row.id);
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
      return this.incidents.responderUpdate(actor, incidentId, mapped === "USER_LOCATED" ? "USER_LOCATED" : "RESPONDING", requestId);
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
      const incident = await this.prisma.incident.findUnique({ where: { id: row.incidentId }, include: { user: true } });
      if (!incident || incident.state === "RESOLVED" || incident.state === "ARCHIVED") continue;
      incidents.push({
        id: incident.id,
        userDisplayName: incident.user.displayName,
        triggerType: incident.triggerType,
        state: incident.state,
        isTest: incident.isTest,
        duress: incident.duress,
        contactStatus: incident.contactStatus,
        assignment: row.status,
      });
    }
    return incidents;
  }

  async position(actor: Actor, journeyId: string, latitude: number, longitude: number) {
    return this.protection.notePosition(actor, journeyId, latitude, longitude);
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
      create: { userId: actor.id, secret, enabled: false, createdAt: now, updatedAt: now },
      update: { secret, enabled: false, updatedAt: now },
    });
    return { secret, otpauth: `otpauth://totp/Guardian:${encodeURIComponent(actor.displayName)}?secret=${secret}&issuer=Guardian` };
  }

  async confirmMfa(actor: Actor, code: string) {
    const row = await this.prisma.operatorMfa.findUnique({ where: { userId: actor.id } });
    if (!row || !verifyTotp(row.secret, code, this.clock.now().getTime())) {
      throw new AppError("INVALID_MFA", 401, "That authenticator code was not accepted.");
    }
    await this.prisma.operatorMfa.update({ where: { userId: actor.id }, data: { enabled: true, updatedAt: this.clock.now() } });
    return { enabled: true };
  }

  async room(token: string) {
    const row = await this.prisma.incidentRoom.findUnique({
      where: { tokenHash: sha256(token) },
      include: { incident: { include: { user: true } } },
    });
    if (!row || row.expiresAt.getTime() < this.clock.now().getTime()) {
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
    const row = await this.prisma.incidentRoom.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.expiresAt.getTime() < this.clock.now().getTime()) {
      throw new AppError("NOT_FOUND", 404, "This room is closed.");
    }
    const now = this.clock.now();
    await this.prisma.incidentRoom.update({ where: { id: row.id }, data: { acknowledgedAt: now } });
    await this.prisma.notificationDelivery.updateMany({
      where: { incidentId: row.incidentId, channel: { in: ["ROOM", "SMS", "FCM", "APNS"] }, acknowledgedAt: null },
      data: { acknowledgedAt: now, status: "ACKNOWLEDGED" },
    });
    if (row.guardianName) {
      await this.prisma.trustedContact.updateMany({
        where: { displayName: row.guardianName, user: { incidents: { some: { id: row.incidentId } } } },
        data: { lastAcknowledgedAt: now },
      });
    }
    await this.record(row.incidentId, "ROOM_ACK", row.guardianName ?? "guardian", "ACKNOWLEDGED", "A guardian opened and acknowledged the room.");
    return { acknowledgedAt: now.toISOString() };
  }

  async acknowledgeDelivery(actor: Actor, deliveryId: string) {
    const row = await this.prisma.notificationDelivery.findUnique({ where: { id: deliveryId } });
    if (!row) throw new AppError("NOT_FOUND", 404, "That delivery was not found.");
    const incident = await this.prisma.incident.findUnique({ where: { id: row.incidentId } });
    if (!incident) throw new AppError("NOT_FOUND", 404, "That incident was not found.");
    const guardian = await this.prisma.trustedContact.findFirst({
      where: {
        userId: incident.userId,
        OR: [{ guardianUserId: actor.id }, { email: { equals: actor.displayName, mode: "insensitive" } }],
      },
    });
    const isOwner = incident.userId === actor.id;
    const isOperator = hasPermission(actor.role, Permission.IncidentReadActive);
    if (!guardian && !isOwner && !isOperator && actor.role !== "GUARDIAN") {
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
    return this.liveCompanion(actor, incidentId);
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
          status: "ON_DUTY",
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

  private async openRoom(incidentId: string, canViewLocation: boolean, canViewEvidence: boolean, guardianName?: string): Promise<{ url: string }> {
    const token = randomBytes(32).toString("base64url");
    const now = this.clock.now();
    await this.prisma.incidentRoom.create({
      data: {
        id: this.ids.uuid(),
        incidentId,
        tokenHash: sha256(token),
        guardianName: guardianName ?? null,
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
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
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
      redis: process.env.REDIS_URL?.trim() ? "configured" : "not configured",
      websocket: "socket.io process attached",
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.npm_package_version ?? "unknown",
      gitCommit: process.env.GIT_COMMIT ?? process.env.SOURCE_VERSION ?? "unknown",
      evidenceQueue: "in-process",
      notificationBacklog: this.outbox ? await this.outbox.backlog() : "in-process-fallback",
      lastBackup: process.env.LAST_BACKUP_AT ?? "not recorded by this process",
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
  constructor(private readonly prisma: PrismaClient) {}

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
      return row?.secret ?? null;
    } catch {
      return null;
    }
  }

  async prepareEnrollment(userId: string, secret: string): Promise<void> {
    const now = new Date();
    await this.prisma.operatorMfa.upsert({
      where: { userId },
      create: { userId, secret, enabled: false, createdAt: now, updatedAt: now },
      update: { secret, enabled: false, updatedAt: now },
    });
  }

  async enable(userId: string): Promise<void> {
    await this.prisma.operatorMfa.updateMany({ where: { userId }, data: { enabled: true, updatedAt: new Date() } });
  }
}
