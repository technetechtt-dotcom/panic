import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Role } from "@guardian/shared-types";
import type { AppConfig } from "../config";
import { FileEvidenceVault, s3Configured } from "./evidence-vault";
import { AppError } from "./errors";
import { canAssignRole, hasPermission, Permission } from "./rbac";
import { IncidentService } from "./incident-service";
import { fusionEvaluate, generateTotpSecret, guardianSmsBody, incidentBrief, searchCorridor, verifyTotp } from "./operations";
import { ProtectionService } from "./protection-service";
import type { Actor, Clock, DeviceStore, IdGenerator, UserStore } from "./ports";
import type { PasswordHasher } from "./security";
import { sha256 } from "./security";
import { sendApns, sendFcm, TwilioSmsProvider } from "./sms";
import { requestMetrics } from "../common/http";
import type { MfaStore } from "./auth-service";

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
  ) {}

  async notifyIncident(incident: { id: string; userId: string; userDisplayName: string; state: string; isTest: boolean }): Promise<void> {
    if (incident.isTest) return;
    try {
      const contacts = await this.prisma.trustedContact.findMany({ where: { userId: incident.userId } });
      const phones = await this.prisma.device.findMany({ where: { userId: incident.userId, fcmToken: { not: null } } });
      for (const contact of contacts) {
        const room = await this.openRoom(incident.id, contact.canViewLocation, contact.canViewEvidence);
        const body = guardianSmsBody({
          name: incident.userDisplayName,
          incidentState: incident.state,
          roomUrl: room.url,
        });
        const sms = contact.phone
          ? await this.sms.send({ to: contact.phone, body, incidentId: incident.id })
          : { delivered: false, simulated: true, reason: "This guardian has no phone number." };
        await this.record(incident.id, "SMS", contact.phone ?? contact.email ?? contact.displayName, sms.delivered ? "SENT" : "SKIPPED", sms.reason);
        await this.record(incident.id, "ROOM", contact.displayName, "SENT", "A private room link was created for this guardian.");
      }
      for (const phone of phones) {
        if (!phone.fcmToken) continue;
        const apple = phone.platform === "IOS";
        const push = apple
          ? await sendApns(phone.fcmToken, "Guardian", `${incident.userDisplayName} needs help.`)
          : await sendFcm(phone.fcmToken, "Guardian", `${incident.userDisplayName} needs help.`);
        await this.record(incident.id, apple ? "APNS" : "FCM", "device", push.delivered ? "SENT" : "SKIPPED", push.reason);
      }
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: "guardian notify failed", detail: error instanceof Error ? error.message : "unknown" }));
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
      select: { id: true, clientChunkId: true, sequence: true, contentType: true, byteLength: true, sha256: true, storageKey: true },
    });
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
    if (row.storageKey) {
      const opened = await this.vault.get(row.storageKey);
      if (!opened) throw new AppError("NOT_FOUND", 404, "The evidence file is not in the vault.");
      return { bytes: opened, contentType: row.contentType };
    }
    return { bytes: Buffer.from(row.payload), contentType: row.contentType };
  }

  async assign(actor: Actor, incidentId: string, responderId: string, requestId: string | null) {
    const responder = await this.users.findById(responderId);
    if (!responder || responder.role !== "RESPONDER") throw new AppError("NOT_FOUND", 404, "That responder account was not found.");
    const now = this.clock.now();
    await this.prisma.responderAssignment.upsert({
      where: { incidentId_responderId: { incidentId, responderId } },
      create: { id: this.ids.uuid(), incidentId, responderId, status: "ASSIGNED", createdAt: now, updatedAt: now },
      update: { status: "ASSIGNED", updatedAt: now },
    });
    return this.incidents.dispatch(actor, incidentId, requestId);
  }

  async responderStatus(actor: Actor, incidentId: string, status: "RESPONDING" | "USER_LOCATED", requestId: string | null) {
    const row = await this.prisma.responderAssignment.findFirst({ where: { incidentId, responderId: actor.id } });
    if (!row) throw new AppError("FORBIDDEN", 403, "This incident is not assigned to you.");
    await this.prisma.responderAssignment.update({ where: { id: row.id }, data: { status, updatedAt: this.clock.now() } });
    return this.incidents.responderUpdate(actor, incidentId, status, requestId);
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
    return {
      displayName: row.incident.user.displayName,
      state: row.incident.state,
      triggerType: row.incident.triggerType,
      location: row.canViewLocation
        ? { latitude: row.incident.lastLatitude, longitude: row.incident.lastLongitude, accuracy: row.incident.lastAccuracy }
        : null,
      evidence,
      notice: "This room shows only what the person allowed this guardian to see.",
    };
  }

  private async openRoom(incidentId: string, canViewLocation: boolean, canViewEvidence: boolean): Promise<{ url: string }> {
    const token = randomBytes(32).toString("base64url");
    const now = this.clock.now();
    await this.prisma.incidentRoom.create({
      data: {
        id: this.ids.uuid(),
        incidentId,
        tokenHash: sha256(token),
        canViewLocation,
        canViewEvidence,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        createdAt: now,
      },
    });
    const origin = this.config.corsOrigins[0] ?? "http://localhost:5173";
    return { url: `${origin}/room/${token}` };
  }

  private async record(incidentId: string, channel: string, destination: string, status: string, detail: string): Promise<void> {
    await this.prisma.notificationDelivery.create({
      data: { id: this.ids.uuid(), incidentId, channel, destination, status, detail, createdAt: this.clock.now() },
    });
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
      smsConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
      fcmConfigured: Boolean(process.env.FCM_SERVER_KEY),
      apnsConfigured: Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID),
      s3Configured: s3Configured(),
      vault: "local-aes-gcm",
      requests: requestMetrics.total,
      serverErrors: requestMetrics.serverErrors,
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
      return row?.enabled ? row.secret : null;
    } catch {
      return null;
    }
  }
}
