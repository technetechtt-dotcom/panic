import { createHash } from "node:crypto";
import type { CancelIncidentInput, EvidenceChunkInput, GuardianInput, JourneyInput, SafetyPinInput } from "@guardian/shared-validation";
import { AppError } from "./errors";
import { hasPermission, Permission } from "./rbac";
import type { PasswordHasher } from "./security";
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
  createdAt: Date;
}

export interface GuardianStore {
  insert(contact: TrustedContactRecord): Promise<void>;
  list(userId: string): Promise<TrustedContactRecord[]>;
  remove(id: string, userId: string): Promise<boolean>;
}

export interface JourneyRecord {
  id: string;
  userId: string;
  destinationLabel: string;
  expectedArrivalAt: Date;
  checkInIntervalSeconds: number;
  lastCheckInAt: Date;
  status: "ACTIVE" | "COMPLETED" | "CONCERN";
}

export interface JourneyStore {
  insert(journey: JourneyRecord): Promise<void>;
  find(id: string, userId: string): Promise<JourneyRecord | null>;
  save(journey: JourneyRecord): Promise<void>;
  listActive(): Promise<JourneyRecord[]>;
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
  incidentId: string;
  clientChunkId: string;
  sequence: number;
  sha256: string;
  byteLength: number;
}

export interface EvidenceStore {
  insert(chunk: EvidenceRecord & { id: string; contentType: string; payload: Buffer; createdAt: Date }): Promise<"created" | "exists">;
  list(incidentId: string): Promise<EvidenceRecord[]>;
}

const MAX_EVIDENCE_BYTES = 200 * 1024;

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
  ) {}

  async addGuardian(actor: Actor, input: GuardianInput, requestId: string | null): Promise<TrustedContactRecord> {
    this.own(actor);
    const contact: TrustedContactRecord = {
      id: this.ids.uuid(),
      userId: actor.id,
      displayName: input.displayName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      canViewLocation: input.canViewLocation ?? false,
      canViewEvidence: input.canViewEvidence ?? false,
      canCancelIncident: false,
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

  async removeGuardian(actor: Actor, id: string): Promise<void> {
    this.own(actor);
    const removed = await this.guardians.remove(id, actor.id);
    if (!removed) throw new AppError("NOT_FOUND", 404, "That guardian was not found.");
  }

  async startJourney(actor: Actor, input: JourneyInput): Promise<JourneyRecord> {
    this.own(actor);
    const now = this.clock.now();
    const journey: JourneyRecord = {
      id: this.ids.uuid(),
      userId: actor.id,
      destinationLabel: input.destinationLabel,
      expectedArrivalAt: new Date(input.expectedArrivalAt),
      checkInIntervalSeconds: input.checkInIntervalSeconds,
      lastCheckInAt: now,
      status: "ACTIVE",
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
      this.publisher.publish("risk.updated", {
        sessionId: journey.id,
        userId: journey.userId,
        status: "CONCERN",
        incidentCreated: false,
      });
      raised += 1;
    }
    return raised;
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

  async addEvidence(actor: Actor, incidentId: string, input: EvidenceChunkInput): Promise<{ stored: boolean; byteLength: number }> {
    if (!hasPermission(actor.role, Permission.IncidentCreateOwn)) {
      throw new AppError("FORBIDDEN", 403, "You cannot add evidence.");
    }
    const incident = await this.incidents.findById(incidentId);
    if (!incident || incident.userId !== actor.id || !ACTIVE_STATES.has(incident.state)) {
      throw new AppError("NOT_FOUND", 404, "There is no active incident for this evidence.");
    }
    const payload = Buffer.from(input.bytesBase64, "base64");
    if (payload.length === 0 || payload.length > MAX_EVIDENCE_BYTES) {
      throw new AppError("EVIDENCE_TOO_LARGE", 413, "Each evidence chunk must be between 1 byte and 200 KB.");
    }
    const actual = createHash("sha256").update(payload).digest("hex");
    if (actual !== input.sha256) throw new AppError("EVIDENCE_HASH_MISMATCH", 422, "The evidence hash does not match the bytes.");
    const outcome = await this.evidence.insert({
      id: this.ids.uuid(),
      incidentId,
      clientChunkId: input.clientChunkId,
      sequence: input.sequence,
      sha256: input.sha256,
      contentType: input.contentType,
      byteLength: payload.length,
      payload,
      createdAt: this.clock.now(),
    });
    if (outcome === "created") this.publisher.publish("evidence.received", { incidentId, sequence: input.sequence });
    return { stored: true, byteLength: payload.length };
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
