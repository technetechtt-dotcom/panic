import { createHash } from "node:crypto";
import type { CancelIncidentInput, EvidenceChunkInput, GuardianInput, GuardianUpdateInput, JourneyInput, SafetyPinInput } from "@guardian/shared-validation";
import { AppError } from "./errors";
import { hasPermission, Permission } from "./rbac";
import type { PasswordHasher } from "./security";
import type { FileEvidenceVault } from "./evidence-vault";
import type { FusionBridge } from "./fusion-bridge";
import { fusionEvaluate, routeDeviates, routeDeviatesPolyline } from "./operations";
import { geocodeDestination, routedPolyline } from "./geocode";
import { ACTIVE_STATES, type Actor, type AuditStore, type Clock, type IdGenerator, type IncidentStore, type RealtimePublisher, type TimelineStore } from "./ports";

export interface TrustedContactRecord {
  id: string;
  userId: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  canViewLocation: boolean;
  canViewEvidence: boolean;
  canCancelIncident: boolean;
  relationship?: string;
  priority?: number;
  notificationMethods?: string;
  guardianUserId?: string | null;
  invitationStatus?: string;
  invitationToken?: string | null;
  lastAcknowledgedAt?: Date | null;
  createdAt: Date;
}

export interface GuardianStore {
  insert(contact: TrustedContactRecord): Promise<void>;
  list(userId: string): Promise<TrustedContactRecord[]>;
  remove(id: string, userId: string): Promise<boolean>;
  findForUser(id: string, userId: string): Promise<TrustedContactRecord | null>;
  findByInvitationToken(token: string): Promise<TrustedContactRecord | null>;
  save(contact: TrustedContactRecord): Promise<void>;
}

export interface JourneyRecord {
  id: string;
  userId: string;
  destinationLabel: string;
  expectedArrivalAt: Date;
  checkInIntervalSeconds: number;
  lastCheckInAt: Date;
  status: "ACTIVE" | "COMPLETED" | "CONCERN";
  mode: "WALK" | "RIDE" | "DRIVE" | "MEETING" | "HIGH_RISK";
  originLatitude: number | null;
  originLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  corridorMeters: number;
  routeGeometry: Array<{ latitude: number; longitude: number }> | null;
  routeSource: "ROUTED" | "STRAIGHT_FALLBACK" | "NONE";
}

export interface JourneyStore {
  insert(journey: JourneyRecord): Promise<void>;
  find(id: string, userId: string): Promise<JourneyRecord | null>;
  save(journey: JourneyRecord): Promise<void>;
  listActive(): Promise<JourneyRecord[]>;
  listForUser?(userId: string): Promise<JourneyRecord[]>;
}

export interface RiskStore {
  record(signal: { id: string; userId: string; sessionId: string; type: string; createdAt: Date }): Promise<"created" | "exists">;
}

export interface PinRecord {
  userId: string;
  cancelPinHash: string;
  duressPinHash: string;
}

export interface PinStore {
  get(userId: string): Promise<PinRecord | null>;
  save(record: PinRecord): Promise<void>;
}

export interface EvidenceRecord {
  id?: string;
  incidentId: string;
  artifactId?: string | null;
  clientChunkId: string;
  sequence: number;
  chunkIndex?: number | null;
  sha256: string;
  byteLength: number;
  contentType?: string;
  storageKey?: string | null;
  payload?: Buffer;
  retentionUntil?: Date | null;
  legalHold?: boolean;
  retentionPolicy?: string;
}

export interface EvidenceArtifactRecord {
  id: string;
  incidentId: string;
  clientCaptureId: string;
  contentType: string;
  originalSha256: string;
  originalByteLength: number;
  capturedAt: Date;
  chunkCount: number;
  status: string;
}

export interface EvidenceStore {
  insert(chunk: EvidenceRecord & { id: string; contentType: string; payload: Buffer; createdAt: Date }): Promise<"created" | "exists">;
  list(incidentId: string): Promise<EvidenceRecord[]>;
  read?(incidentId: string, clientChunkId: string): Promise<(EvidenceRecord & { payload: Buffer }) | null>;
  upsertArtifact?(artifact: Omit<EvidenceArtifactRecord, "status"> & { createdAt: Date; retentionUntil: Date; retentionPolicy: string }): Promise<EvidenceArtifactRecord>;
  listArtifactChunks?(artifactId: string): Promise<Array<EvidenceRecord & { payload: Buffer }>>;
  markArtifact?(artifactId: string, status: "COMPLETE" | "CORRUPT", completedAt: Date | null): Promise<void>;
}

function maxEvidenceBytes(contentType: string): number {
  return contentType === "audio/pcm" ? 200 * 1024 : 1_500_000;
}

export class ProtectionService {
  constructor(
    private readonly guardians: GuardianStore,
    private readonly journeys: JourneyStore,
    private readonly risks: RiskStore,
    private readonly pins: PinStore,
    private readonly evidence: EvidenceStore,
    private readonly incidents: IncidentStore,
    private readonly timeline: TimelineStore,
    private readonly audit: AuditStore,
    private readonly publisher: RealtimePublisher,
    private readonly passwords: PasswordHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fusion: FusionBridge | null = null,
    private readonly vault: FileEvidenceVault | null = null,
  ) {}

  async addGuardian(actor: Actor, input: GuardianInput, requestId: string | null): Promise<TrustedContactRecord> {
    this.own(actor);
    const invited = Boolean(input.email);
    const contact: TrustedContactRecord = {
      id: this.ids.uuid(),
      userId: actor.id,
      displayName: input.displayName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      canViewLocation: input.canViewLocation ?? false,
      canViewEvidence: input.canViewEvidence ?? false,
      canCancelIncident: false,
      relationship: input.relationship ?? "FRIEND",
      priority: input.priority ?? 1,
      notificationMethods: input.notificationMethods ?? "PUSH,SMS",
      guardianUserId: null,
      invitationStatus: invited ? "PENDING" : "ACCEPTED",
      invitationToken: invited ? this.ids.uuid() : null,
      createdAt: this.clock.now(),
    };
    await this.guardians.insert(contact);
    await this.audit.append({
      id: this.ids.uuid(),
      actorId: actor.id,
      action: "guardian.added",
      entityType: "TrustedContact",
      entityId: contact.id,
      correlationId: null,
      requestId,
      metadata: { canViewLocation: contact.canViewLocation, canViewEvidence: contact.canViewEvidence },
      createdAt: contact.createdAt,
    });
    return contact;
  }

  listGuardians(actor: Actor): Promise<TrustedContactRecord[]> {
    this.own(actor);
    return this.guardians.list(actor.id);
  }

  async updateGuardian(actor: Actor, id: string, input: GuardianUpdateInput, requestId: string | null): Promise<TrustedContactRecord> {
    this.own(actor);
    const contact = await this.guardians.findForUser(id, actor.id);
    if (!contact) throw new AppError("NOT_FOUND", 404, "That Guardian was not found.");
    if (input.canViewLocation !== undefined) contact.canViewLocation = input.canViewLocation;
    if (input.canViewEvidence !== undefined) contact.canViewEvidence = input.canViewEvidence;
    if (input.relationship !== undefined) contact.relationship = input.relationship;
    if (input.priority !== undefined) contact.priority = input.priority;
    if (input.notificationMethods !== undefined) contact.notificationMethods = input.notificationMethods;
    await this.guardians.save(contact);
    await this.audit.append({
      id: this.ids.uuid(),
      actorId: actor.id,
      action: "guardian.updated",
      entityType: "TrustedContact",
      entityId: contact.id,
      correlationId: null,
      requestId,
      metadata: {
        priority: contact.priority,
        notificationMethods: contact.notificationMethods,
        canViewLocation: contact.canViewLocation,
        canViewEvidence: contact.canViewEvidence,
      },
      createdAt: this.clock.now(),
    });
    return contact;
  }

  async removeGuardian(actor: Actor, id: string): Promise<void> {
    this.own(actor);
    const removed = await this.guardians.remove(id, actor.id);
    if (!removed) throw new AppError("NOT_FOUND", 404, "That guardian was not found.");
  }

  async acceptInvitation(actor: Actor, token: string): Promise<TrustedContactRecord> {
    const contact = await this.guardians.findByInvitationToken(token);
    if (!contact || contact.invitationStatus === "DECLINED") {
      throw new AppError("NOT_FOUND", 404, "That invitation was not found.");
    }
    contact.guardianUserId = actor.id;
    contact.invitationStatus = "ACCEPTED";
    await this.guardians.save(contact);
    return contact;
  }

  listJourneys(actor: Actor): Promise<JourneyRecord[]> {
    this.own(actor);
    return this.journeys.listForUser?.(actor.id) ?? this.journeys.listActive().then((rows) => rows.filter((row) => row.userId === actor.id));
  }

  async extendJourney(actor: Actor, id: string, minutes: number): Promise<JourneyRecord> {
    const journey = await this.requireJourney(actor, id);
    journey.expectedArrivalAt = new Date(journey.expectedArrivalAt.getTime() + minutes * 60_000);
    await this.journeys.save(journey);
    return journey;
  }

  async previewDestination(actor: Actor, label: string): Promise<{ label: string; latitude: number; longitude: number } | null> {
    this.own(actor);
    const geo = await geocodeDestination(label);
    return geo ? { label: geo.label, latitude: geo.latitude, longitude: geo.longitude } : null;
  }

  async startJourney(actor: Actor, input: JourneyInput): Promise<JourneyRecord> {
    this.own(actor);
    const now = this.clock.now();
    const mode = input.mode ?? "WALK";
    let destinationLatitude = input.destinationLatitude ?? null;
    let destinationLongitude = input.destinationLongitude ?? null;
    if (destinationLatitude == null || destinationLongitude == null) {
      const geo = await geocodeDestination(input.destinationLabel);
      destinationLatitude = geo?.latitude ?? null;
      destinationLongitude = geo?.longitude ?? null;
    }
    let routeGeometry: Array<{ latitude: number; longitude: number }> | null = null;
    let routeSource: JourneyRecord["routeSource"] = "NONE";
    const originLatitude = input.originLatitude ?? null;
    const originLongitude = input.originLongitude ?? null;
    if (originLatitude != null && originLongitude != null && destinationLatitude != null && destinationLongitude != null) {
      const routed = await routedPolyline(
        { latitude: originLatitude, longitude: originLongitude },
        { latitude: destinationLatitude, longitude: destinationLongitude },
        mode === "WALK" ? "walking" : "driving",
      );
      if (routed?.length) {
        routeGeometry = routed;
        routeSource = "ROUTED";
      } else if (mode !== "RIDE" && mode !== "DRIVE") {
        routeGeometry = [
          { latitude: originLatitude, longitude: originLongitude },
          { latitude: destinationLatitude, longitude: destinationLongitude },
        ];
        routeSource = "STRAIGHT_FALLBACK";
      }
    }
    const journey: JourneyRecord = {
      id: this.ids.uuid(),
      userId: actor.id,
      destinationLabel: input.destinationLabel,
      expectedArrivalAt: new Date(input.expectedArrivalAt),
      checkInIntervalSeconds: input.checkInIntervalSeconds,
      lastCheckInAt: now,
      status: "ACTIVE",
      mode,
      originLatitude,
      originLongitude,
      destinationLatitude,
      destinationLongitude,
      corridorMeters: input.corridorMeters ?? (mode === "MEETING" ? 200 : mode === "RIDE" || mode === "DRIVE" ? 800 : mode === "HIGH_RISK" ? 250 : 400),
      routeGeometry,
      routeSource,
    };
    await this.journeys.insert(journey);
    return journey;
  }

  async checkIn(actor: Actor, id: string): Promise<JourneyRecord> {
    const journey = await this.requireJourney(actor, id);
    journey.lastCheckInAt = this.clock.now();
    if (journey.status === "CONCERN") journey.status = "ACTIVE";
    await this.journeys.save(journey);
    return journey;
  }

  async completeJourney(actor: Actor, id: string): Promise<JourneyRecord> {
    const journey = await this.requireJourney(actor, id);
    journey.status = "COMPLETED";
    await this.journeys.save(journey);
    return journey;
  }

  async sweepJourneys(): Promise<number> {
    let raised = 0;
    const now = this.clock.now();
    for (const journey of await this.journeys.listActive()) {
      const checkInDue = now.getTime() - journey.lastCheckInAt.getTime() > journey.checkInIntervalSeconds * 1000;
      const arrivalMissed = now.getTime() > journey.expectedArrivalAt.getTime();
      if (!checkInDue && !arrivalMissed) continue;
      const signals = [
        ...(checkInDue ? ["MISSED_CHECK_IN"] : []),
        ...(arrivalMissed ? ["NO_RESPONSE"] : []),
      ];
      const outcome = await this.risks.record({
        id: this.ids.uuid(),
        userId: journey.userId,
        sessionId: journey.id,
        type: arrivalMissed ? "JOURNEY_ARRIVAL_MISSED" : "JOURNEY_CHECK_IN_MISSED",
        createdAt: now,
      });
      if (outcome === "exists") continue;
      journey.status = "CONCERN";
      await this.journeys.save(journey);
      const scored = fusionEvaluate(signals);
      let incidentCreated = false;
      if (this.fusion && scored.level === "HIGH_RISK") {
        await this.fusion.raise(journey.userId, "SYSTEM_RISK_ESCALATION");
        incidentCreated = true;
      } else if (this.fusion) {
        await this.fusion.raise(journey.userId, "JOURNEY_TIMEOUT");
        incidentCreated = true;
      }
      this.publisher.publish("risk.updated", {
        sessionId: journey.id,
        userId: journey.userId,
        status: scored.level === "NORMAL" ? "CONCERN" : scored.level,
        incidentCreated,
      });
      raised += 1;
    }
    return raised;
  }

  async notePosition(actor: Actor, id: string, latitude: number, longitude: number): Promise<{ deviated: boolean; level: string }> {
    const journey = await this.requireJourney(actor, id);
    if (
      journey.originLatitude === null ||
      journey.originLongitude === null ||
      journey.destinationLatitude === null ||
      journey.destinationLongitude === null
    ) {
      return { deviated: false, level: "NORMAL" };
    }
    const deviated = journey.routeGeometry?.length
      ? routeDeviatesPolyline(latitude, longitude, journey.routeGeometry, journey.corridorMeters)
      : journey.mode === "RIDE" || journey.mode === "DRIVE"
        ? false
        : routeDeviates(
            latitude,
            longitude,
            journey.originLatitude,
            journey.originLongitude,
            journey.destinationLatitude,
            journey.destinationLongitude,
            journey.corridorMeters,
          );
    if (!deviated) return { deviated: false, level: "NORMAL" };
    const scored = fusionEvaluate(["ROUTE_DEVIATION"]);
    await this.risks.record({
      id: this.ids.uuid(),
      userId: actor.id,
      sessionId: journey.id,
      type: "ROUTE_DEVIATION",
      createdAt: this.clock.now(),
    });
    this.publisher.publish("risk.updated", {
      sessionId: journey.id,
      userId: journey.userId,
      status: scored.level,
      incidentCreated: false,
    });
    return { deviated: true, level: scored.level };
  }

  async setPins(actor: Actor, input: SafetyPinInput): Promise<void> {
    this.own(actor);
    await this.pins.save({
      userId: actor.id,
      cancelPinHash: await this.passwords.hash(input.cancelPin),
      duressPinHash: await this.passwords.hash(input.duressPin),
    });
  }

  async cancel(actor: Actor, incidentId: string, input: CancelIncidentInput, requestId: string | null): Promise<{ appearance: "CANCELLED" }> {
    if (!hasPermission(actor.role, Permission.IncidentCreateOwn)) {
      throw new AppError("FORBIDDEN", 403, "You cannot cancel this incident.");
    }
    const incident = await this.incidents.findById(incidentId);
    if (!incident || incident.userId !== actor.id) throw new AppError("NOT_FOUND", 404, "Incident not found.");
    const pins = await this.pins.get(actor.id);
    if (!pins) throw new AppError("PIN_NOT_SET", 409, "Set a cancel PIN and a duress PIN before using them.");
    const [duress, normal] = await Promise.all([
      this.passwords.verify(input.pin, pins.duressPinHash),
      this.passwords.verify(input.pin, pins.cancelPinHash),
    ]);
    if (!duress && !normal) throw new AppError("INVALID_PIN", 401, "That PIN was not recognised.");
    const now = this.clock.now();
    if (duress) {
      incident.duress = true;
      incident.updatedAt = now;
      await this.incidents.save(incident);
      await this.timeline.append({
        id: this.ids.uuid(),
        incidentId: incident.id,
        type: "duress.confirmed",
        message: "Possible forced cancellation. The incident stays open.",
        occurredAt: now.toISOString(),
        actorId: actor.id,
      });
      await this.audit.append({
        id: this.ids.uuid(),
        actorId: actor.id,
        action: "duress.confirmed",
        entityType: "Incident",
        entityId: incident.id,
        correlationId: incident.correlationId,
        requestId,
        metadata: null,
        createdAt: now,
      });
      this.publisher.publish("duress.detected", { incidentId: incident.id });
    } else if (ACTIVE_STATES.has(incident.state)) {
      incident.state = "RESOLVED";
      incident.resolvedAt = now;
      incident.resolvedById = actor.id;
      incident.updatedAt = now;
      await this.incidents.save(incident);
      await this.timeline.append({
        id: this.ids.uuid(),
        incidentId: incident.id,
        type: "incident.resolved",
        message: "The user cancelled the emergency.",
        occurredAt: now.toISOString(),
        actorId: actor.id,
      });
      this.publisher.publish("incident.resolved", { id: incident.id, state: "RESOLVED" });
    }
    return { appearance: "CANCELLED" };
  }

  async addEvidence(actor: Actor, incidentId: string, input: EvidenceChunkInput): Promise<{ stored: boolean; byteLength: number; artifactComplete: boolean }> {
    if (!hasPermission(actor.role, Permission.IncidentCreateOwn)) {
      throw new AppError("FORBIDDEN", 403, "You cannot add evidence.");
    }
    const incident = await this.incidents.findById(incidentId);
    if (!incident || incident.userId !== actor.id || !ACTIVE_STATES.has(incident.state)) {
      throw new AppError("NOT_FOUND", 404, "There is no active incident for this evidence.");
    }
    if (actor.emergencyDeviceId && actor.emergencyDeviceId !== incident.deviceId) {
      throw new AppError("FORBIDDEN", 403, "This emergency credential is bound to a different phone.");
    }
    const payload = Buffer.from(input.bytesBase64, "base64");
    const limit = maxEvidenceBytes(input.contentType);
    if (payload.length === 0 || payload.length > limit) {
      throw new AppError("EVIDENCE_TOO_LARGE", 413, `Each ${input.contentType} chunk must be between 1 byte and ${Math.floor(limit / 1024)} KB.`);
    }
    const actual = createHash("sha256").update(payload).digest("hex");
    if (actual !== input.sha256) throw new AppError("EVIDENCE_HASH_MISMATCH", 422, "The evidence hash does not match the bytes.");

    const now = this.clock.now();
    const captureId = input.captureId ?? input.clientChunkId;
    const chunkIndex = input.chunkIndex ?? 0;
    const chunkCount = input.chunkCount ?? 1;
    const originalSha256 = input.originalSha256 ?? input.sha256;
    const originalByteLength = input.originalByteLength ?? payload.length;
    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : now;
    const retentionUntil = new Date(now.getTime() + Number(process.env.EVIDENCE_RETENTION_DAYS ?? 365) * 24 * 60 * 60 * 1000);
    const retentionPolicy = process.env.EVIDENCE_RETENTION_POLICY?.trim() || "STANDARD";

    let artifactId: string | null = null;
    if (this.evidence.upsertArtifact) {
      const artifact = await this.evidence.upsertArtifact({
        id: this.ids.uuid(),
        incidentId,
        clientCaptureId: captureId,
        contentType: input.contentType,
        originalSha256,
        originalByteLength,
        capturedAt,
        chunkCount,
        createdAt: now,
        retentionUntil,
        retentionPolicy,
      });
      if (
        artifact.contentType !== input.contentType ||
        artifact.originalSha256 !== originalSha256 ||
        artifact.originalByteLength !== originalByteLength ||
        artifact.chunkCount !== chunkCount
      ) {
        throw new AppError("EVIDENCE_ARTIFACT_CONFLICT", 409, "Evidence artifact metadata changed between chunks.");
      }
      artifactId = artifact.id;
    }

    let storageKey: string | null = null;
    let storedPayload = payload;
    if (this.vault) {
      storageKey = this.ids.uuid();
      await this.vault.put(storageKey, payload);
      storedPayload = Buffer.alloc(0);
    }
    const outcome = await this.evidence.insert({
      id: this.ids.uuid(),
      incidentId,
      artifactId,
      clientChunkId: input.clientChunkId,
      sequence: input.sequence,
      chunkIndex,
      sha256: input.sha256,
      contentType: input.contentType,
      byteLength: payload.length,
      storageKey,
      retentionUntil,
      legalHold: false,
      retentionPolicy,
      payload: storedPayload,
      createdAt: now,
    });

    let artifactComplete = false;
    if (artifactId && this.evidence.listArtifactChunks && this.evidence.markArtifact) {
      const chunks = await this.evidence.listArtifactChunks(artifactId);
      if (chunks.length === chunkCount) {
        const ordered = chunks.slice().sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
        const opened: Buffer[] = [];
        for (const chunk of ordered) {
          const bytes = chunk.storageKey && this.vault ? await this.vault.get(chunk.storageKey) : chunk.payload;
          if (!bytes) {
            await this.evidence.markArtifact(artifactId, "CORRUPT", null);
            throw new AppError("EVIDENCE_ARTIFACT_MISSING", 409, "An evidence artifact chunk is unavailable.");
          }
          opened.push(bytes);
        }
        const original = Buffer.concat(opened);
        const digest = createHash("sha256").update(original).digest("hex");
        if (original.length !== originalByteLength || digest !== originalSha256) {
          await this.evidence.markArtifact(artifactId, "CORRUPT", null);
          throw new AppError("EVIDENCE_ARTIFACT_HASH_MISMATCH", 422, "The reconstructed evidence artifact does not match its original hash or size.");
        }
        await this.evidence.markArtifact(artifactId, "COMPLETE", now);
        artifactComplete = true;
      }
    }

    if (outcome === "created") {
      this.publisher.publish("evidence.received", { incidentId, sequence: input.sequence, captureId, chunkIndex, chunkCount, artifactComplete });
    }
    return { stored: true, byteLength: payload.length, artifactComplete };
  }

  private own(actor: Actor): void {
    if (!hasPermission(actor.role, Permission.ProtectionManageOwn)) {
      throw new AppError("FORBIDDEN", 403, "You cannot change protection settings.");
    }
  }

  private async requireJourney(actor: Actor, id: string): Promise<JourneyRecord> {
    this.own(actor);
    const journey = await this.journeys.find(id, actor.id);
    if (!journey || journey.status === "COMPLETED") throw new AppError("NOT_FOUND", 404, "That journey is not active.");
    return journey;
  }
}
