import type { Incident, IncidentSummary } from "@guardian/shared-types";
import {
  distressCapsuleByteLength,
  isDeliberateTrigger,
  MAX_DISTRESS_CAPSULE_BYTES,
  type CreateIncidentInput,
  type HeartbeatInput,
  type LocationBatchInput,
} from "@guardian/shared-validation";
import { AppError, UniqueConflictError } from "./errors";
import { canTransition, isStale } from "./incident-rules";
import { hasPermission, Permission } from "./rbac";
import { canonicalJson, deviceProofMessage, sha256, verifyDeviceProof } from "./security";
import {
  ACTIVE_STATES,
  triggerLabel,
  type Actor,
  type AuditStore,
  type Clock,
  type DeviceStore,
  type HeartbeatStore,
  type IdGenerator,
  type IncidentRecord,
  type IncidentStore,
  type LocationStore,
  type RealtimePublisher,
  type StoredHeartbeat,
  type TimelineStore,
} from "./ports";

export interface CreateIncidentResult {
  incident: Incident;
  replayed: boolean;
  escalated: boolean;
}

export class IncidentService {
  constructor(
    private readonly incidents: IncidentStore,
    private readonly devices: DeviceStore,
    private readonly locations: LocationStore,
    private readonly heartbeats: HeartbeatStore,
    private readonly timeline: TimelineStore,
    private readonly audit: AuditStore,
    private readonly publisher: RealtimePublisher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly staleAfterSeconds: number,
  ) {}

  async create(actor: Actor, input: CreateIncidentInput, requestId: string | null): Promise<CreateIncidentResult> {
    if (!hasPermission(actor.role, Permission.IncidentCreateOwn)) {
      throw new AppError("FORBIDDEN", 403, "You cannot create an incident.");
    }
    if (!isDeliberateTrigger(input.triggerType)) {
      throw new AppError(
        "FUSION_NOT_ENABLED",
        422,
        "This trigger is not a deliberate SOS. Automatic risk escalation is not enabled, so no incident was created.",
      );
    }
    if (distressCapsuleByteLength(input.distressCapsule) > MAX_DISTRESS_CAPSULE_BYTES) {
      throw new AppError("CAPSULE_TOO_LARGE", 422, "The distress capsule exceeds its size limit.");
    }
    const requestHash = sha256(canonicalJson(input));
    const existing = await this.incidents.findByTriggerId(input.triggerId);
    if (existing) return this.replay(actor, existing, requestHash);

    const device = await this.devices.findByIdForUser(input.deviceId, actor.id);
    if (!device) {
      throw new AppError("DEVICE_NOT_FOUND", 404, "Register this device before sending an SOS.");
    }
    this.assertDeviceProof(device, input);

    const prior = await this.incidents.findEscalation(input.triggerId);
    if (prior) {
      const incident = await this.incidents.findById(prior.incidentId);
      if (incident && incident.userId === actor.id) {
        return { incident: toIncidentDto(incident), replayed: true, escalated: true };
      }
    }

    const active = await this.incidents.findActiveForUser(actor.id);
    if (active) return this.escalate(actor, active, input, requestId);

    const now = this.clock.now();
    const capsule = input.distressCapsule;
    const incident: IncidentRecord = {
      id: this.ids.uuid(),
      userId: actor.id,
      deviceId: device.id,
      triggerId: input.triggerId,
      triggerType: input.triggerType,
      requestHash,
      state: "SOS",
      isTest: input.isTest,
      duress: input.triggerType === "DURESS" || capsule.duress,
      correlationId: input.correlationId,
      protectionMode: capsule.protectionMode,
      contactStatus: "ONLINE",
      contactLostAt: null,
      capsule,
      lastHeartbeatAt: null,
      lastPositionAt: capsule.latitude !== null && capsule.longitude !== null ? new Date(capsule.timestamp) : null,
      lastLatitude: capsule.latitude,
      lastLongitude: capsule.longitude,
      lastAccuracy: capsule.locationAccuracy,
      lastSpeed: capsule.speed,
      lastHeading: capsule.heading,
      lastBattery: capsule.batteryLevel,
      acknowledgedAt: null,
      acknowledgedById: null,
      resolvedAt: null,
      resolvedById: null,
      createdAt: now,
      updatedAt: now,
      userDisplayName: actor.displayName,
    };

    try {
      await this.incidents.insert(incident);
    } catch (error) {
      if (error instanceof UniqueConflictError) {
        const raced = await this.incidents.findByTriggerId(input.triggerId);
        if (raced) return this.replay(actor, raced, requestHash);
        const activeNow = await this.incidents.findActiveForUser(actor.id);
        if (activeNow) return this.escalate(actor, activeNow, input, requestId);
      }
      throw error;
    }

    await this.timeline.append({
      id: this.ids.uuid(),
      incidentId: incident.id,
      type: "trigger.received",
      message: `${triggerLabel(input.triggerType)} detected`,
      occurredAt: new Date(capsule.timestamp).toISOString(),
      actorId: actor.id,
    });
    await this.timeline.append({
      id: this.ids.uuid(),
      incidentId: incident.id,
      type: "incident.created",
      message: input.isTest ? "Test SOS created" : "SOS created",
      occurredAt: now.toISOString(),
      actorId: actor.id,
    });
    await this.audit.append({
      id: this.ids.uuid(),
      actorId: actor.id,
      action: "incident.created",
      entityType: "Incident",
      entityId: incident.id,
      correlationId: incident.correlationId,
      requestId,
      metadata: { triggerType: input.triggerType, isTest: input.isTest, duress: incident.duress },
      createdAt: now,
    });
    const dto = toIncidentDto(incident);
    this.publisher.publish("incident.created", dto);
    return { incident: dto, replayed: false, escalated: false };
  }

  private assertDeviceProof(device: { publicKey?: string | null; devicePublicId: string }, input: CreateIncidentInput): void {
    if (!device.publicKey) return;
    const proof = input.deviceProof;
    if (!proof) throw new AppError("DEVICE_PROOF_REQUIRED", 401, "This phone must sign the SOS.");
    const skew = Math.abs(this.clock.now().getTime() - new Date(proof.signedAt).getTime());
    if (skew > 10 * 60 * 1000) throw new AppError("DEVICE_PROOF_EXPIRED", 401, "The SOS signature is too old.");
    const message = deviceProofMessage(input.triggerId, device.devicePublicId, proof.signedAt);
    if (!verifyDeviceProof(device.publicKey, proof.signature, message)) {
      throw new AppError("DEVICE_PROOF_INVALID", 401, "The SOS signature does not match this phone.");
    }
  }

  private async escalate(
    actor: Actor,
    active: IncidentRecord,
    input: CreateIncidentInput,
    requestId: string | null,
  ): Promise<CreateIncidentResult> {
    const now = this.clock.now();
    const recorded = await this.incidents.recordEscalation({
      id: this.ids.uuid(),
      incidentId: active.id,
      triggerId: input.triggerId,
      triggerType: input.triggerType,
      createdAt: now,
    });
    if (recorded === "created") {
      const stage = input.metadata?.stage;
      if (stage === "EVIDENCE" || stage === "PRIORITY") {
        active.protectionMode = stage === "EVIDENCE" ? "EVIDENCE" : "HIGH_PRIORITY";
        active.updatedAt = now;
        await this.incidents.save(active);
        await this.timeline.append({
          id: this.ids.uuid(),
          incidentId: active.id,
          type: stage === "EVIDENCE" ? "evidence.started" : "incident.priority",
          message: stage === "EVIDENCE"
            ? "A second trigger started evidence mode."
            : "Another trigger raised this incident to high priority.",
          occurredAt: now.toISOString(),
          actorId: actor.id,
        });
      }
      if (active.isTest && !input.isTest) {
        active.isTest = false;
        active.updatedAt = now;
        await this.incidents.save(active);
        await this.timeline.append({
          id: this.ids.uuid(),
          incidentId: active.id,
          type: "incident.promoted",
          message: "A real SOS replaced the test session on this incident.",
          occurredAt: now.toISOString(),
          actorId: actor.id,
        });
      }
      await this.timeline.append({
        id: this.ids.uuid(),
        incidentId: active.id,
        type: "incident.escalated",
        message: input.isTest && !active.isTest
          ? "A test trigger arrived during a live incident."
          : `${triggerLabel(input.triggerType)} repeated. The open incident was escalated.`,
        occurredAt: now.toISOString(),
        actorId: actor.id,
      });
      await this.audit.append({
        id: this.ids.uuid(),
        actorId: actor.id,
        action: "incident.escalated",
        entityType: "Incident",
        entityId: active.id,
        correlationId: active.correlationId,
        requestId,
        metadata: { triggerType: input.triggerType, triggerId: input.triggerId, isTest: input.isTest },
        createdAt: now,
      });
      this.publisher.publish("incident.updated", toIncidentDto(active));
    }
    return { incident: toIncidentDto(active), replayed: recorded === "exists", escalated: true };
  }

  async listForActor(actor: Actor): Promise<Incident[]> {
    if (hasPermission(actor.role, Permission.IncidentReadActive)) {
      const rows = await this.incidents.listActive();
      return rows.map(toIncidentDto);
    }
    if (hasPermission(actor.role, Permission.IncidentReadOwn)) {
      const rows = await this.incidents.listForUser(actor.id);
      return rows.map(toIncidentDto);
    }
    throw new AppError("FORBIDDEN", 403, "You cannot list incidents.");
  }

  async summary(actor: Actor): Promise<IncidentSummary> {
    if (!hasPermission(actor.role, Permission.IncidentReadActive)) {
      throw new AppError("FORBIDDEN", 403, "You cannot view incident metrics.");
    }
    const rows = (await this.incidents.listActive()).filter((row) => !row.isTest);
    return {
      activeIncidents: rows.length,
      unacknowledgedIncidents: rows.filter((row) => row.state === "SOS").length,
      duressAlerts: rows.filter((row) => row.duress).length,
      devicesContactLost: rows.filter((row) => row.contactStatus === "DEVICE_CONTACT_LOST").length,
      highRiskAlerts: null,
      respondersActive: null,
    };
  }

  async get(actor: Actor, incidentId: string): Promise<Incident> {
    const incident = await this.requireReadable(actor, incidentId);
    return toIncidentDto(incident);
  }

  async addLocations(actor: Actor, incidentId: string, input: LocationBatchInput, requestId: string | null) {
    const incident = await this.requireWritableUpdate(actor, incidentId);
    let inserted = 0;
    let duplicates = 0;
    let first = (await this.locations.list(incident.id)).length === 0;
    for (const point of input.points) {
      const outcome = await this.locations.insertIfAbsent({ ...point, id: this.ids.uuid(), incidentId: incident.id });
      if (outcome === "exists") {
        duplicates += 1;
        continue;
      }
      inserted += 1;
      const recordedAt = new Date(point.recordedAt);
      if (!incident.lastPositionAt || recordedAt.getTime() >= incident.lastPositionAt.getTime()) {
        incident.lastLatitude = point.latitude;
        incident.lastLongitude = point.longitude;
        incident.lastAccuracy = point.accuracy;
        incident.lastSpeed = point.speed;
        incident.lastHeading = point.bearing;
        incident.lastPositionAt = recordedAt;
        incident.updatedAt = this.clock.now();
      }
      if (first) {
        first = false;
        await this.timeline.append({
          id: this.ids.uuid(),
          incidentId: incident.id,
          type: "location.received",
          message: "Location received",
          occurredAt: recordedAt.toISOString(),
          actorId: actor.id,
        });
      }
    }
    await this.incidents.save(incident);
    if (inserted > 0) {
      await this.audit.append({
        id: this.ids.uuid(),
        actorId: actor.id,
        action: "incident.location_appended",
        entityType: "Incident",
        entityId: incident.id,
        correlationId: incident.correlationId,
        requestId,
        metadata: { inserted, duplicates },
        createdAt: this.clock.now(),
      });
      this.publisher.publish("location.updated", {
        incidentId: incident.id,
        latitude: incident.lastLatitude,
        longitude: incident.lastLongitude,
        accuracy: incident.lastAccuracy,
        isTest: incident.isTest,
      });
    }
    return { inserted, duplicates };
  }

  async addHeartbeat(actor: Actor, incidentId: string, input: HeartbeatInput, requestId: string | null) {
    const incident = await this.requireWritableUpdate(actor, incidentId);
    const heartbeat: StoredHeartbeat = { ...input, id: this.ids.uuid(), incidentId: incident.id };
    const outcome = await this.heartbeats.insertIfAbsent(heartbeat);
    if (outcome === "exists") return { replayed: true };
    const recordedAt = new Date(input.recordedAt);
    const wasLost = incident.contactStatus === "DEVICE_CONTACT_LOST";
    incident.lastHeartbeatAt = recordedAt;
    incident.contactStatus = "ONLINE";
    incident.contactLostAt = null;
    incident.lastBattery = input.batteryLevel;
    if (input.latitude !== null && input.longitude !== null) {
      const positionAt = new Date(input.recordedAt);
      if (!incident.lastPositionAt || positionAt.getTime() >= incident.lastPositionAt.getTime()) {
        incident.lastLatitude = input.latitude;
        incident.lastLongitude = input.longitude;
        incident.lastAccuracy = input.accuracy;
        incident.lastSpeed = input.speed;
        incident.lastHeading = input.heading;
        incident.lastPositionAt = positionAt;
      }
    }
    incident.updatedAt = this.clock.now();
    await this.incidents.save(incident);
    if (wasLost) {
      await this.timeline.append({
        id: this.ids.uuid(),
        incidentId: incident.id,
        type: "device.contact_restored",
        message: "Device contact restored",
        occurredAt: recordedAt.toISOString(),
        actorId: null,
      });
      await this.audit.append({
        id: this.ids.uuid(),
        actorId: actor.id,
        action: "incident.contact_restored",
        entityType: "Incident",
        entityId: incident.id,
        correlationId: incident.correlationId,
        requestId,
        metadata: null,
        createdAt: this.clock.now(),
      });
    }
    this.publisher.publish("heartbeat.updated", {
      incidentId: incident.id,
      recordedAt: input.recordedAt,
      batteryLevel: input.batteryLevel,
      networkType: input.networkType,
      contactStatus: incident.contactStatus,
      isTest: incident.isTest,
    });
    return { replayed: false };
  }

  async acknowledge(actor: Actor, incidentId: string, note: string | undefined, requestId: string | null) {
    if (!hasPermission(actor.role, Permission.IncidentAcknowledge)) {
      throw new AppError("FORBIDDEN", 403, "You cannot acknowledge incidents.");
    }
    const incident = await this.requireKnown(incidentId);
    this.assertTransition(incident, "ACKNOWLEDGED");
    const now = this.clock.now();
    incident.state = "ACKNOWLEDGED";
    incident.acknowledgedAt = now;
    incident.acknowledgedById = actor.id;
    incident.updatedAt = now;
    await this.incidents.save(incident);
    await this.timeline.append({
      id: this.ids.uuid(),
      incidentId: incident.id,
      type: "incident.acknowledged",
      message: note
        ? `Monitoring operator acknowledged incident. ${note}`
        : "Monitoring operator acknowledged incident",
      occurredAt: now.toISOString(),
      actorId: actor.id,
    });
    await this.writeStateAudit(actor, incident, "incident.acknowledged", requestId, now);
    const dto = toIncidentDto(incident);
    this.publisher.publish("incident.acknowledged", dto);
    return dto;
  }

  async resolve(actor: Actor, incidentId: string, note: string | undefined, requestId: string | null) {
    if (!hasPermission(actor.role, Permission.IncidentResolve)) {
      throw new AppError("FORBIDDEN", 403, "You cannot resolve incidents.");
    }
    const incident = await this.requireKnown(incidentId);
    this.assertTransition(incident, "RESOLVED");
    const now = this.clock.now();
    incident.state = "RESOLVED";
    incident.resolvedAt = now;
    incident.resolvedById = actor.id;
    incident.updatedAt = now;
    await this.incidents.save(incident);
    await this.timeline.append({
      id: this.ids.uuid(),
      incidentId: incident.id,
      type: "incident.resolved",
      message: note ? `Incident resolved. ${note}` : "Incident resolved",
      occurredAt: now.toISOString(),
      actorId: actor.id,
    });
    await this.writeStateAudit(actor, incident, "incident.resolved", requestId, now);
    const dto = toIncidentDto(incident);
    this.publisher.publish("incident.resolved", dto);
    return dto;
  }

  async timelineFor(actor: Actor, incidentId: string) {
    await this.requireReadable(actor, incidentId);
    return this.timeline.list(incidentId);
  }

  async locationsFor(actor: Actor, incidentId: string) {
    await this.requireReadable(actor, incidentId);
    return this.locations.list(incidentId);
  }

  async heartbeatsFor(actor: Actor, incidentId: string) {
    await this.requireReadable(actor, incidentId);
    return this.heartbeats.list(incidentId, 50);
  }

  async sweepStaleContacts(): Promise<number> {
    const now = this.clock.now();
    let marked = 0;
    for (const incident of await this.incidents.listActive()) {
      if (!ACTIVE_STATES.has(incident.state) || incident.contactStatus === "DEVICE_CONTACT_LOST") continue;
      const last = incident.lastHeartbeatAt ?? incident.createdAt;
      if (!isStale(last, now, this.staleAfterSeconds)) continue;
      incident.contactStatus = "DEVICE_CONTACT_LOST";
      incident.contactLostAt = now;
      incident.updatedAt = now;
      await this.incidents.save(incident);
      await this.timeline.append({
        id: this.ids.uuid(),
        incidentId: incident.id,
        type: "device.contact_lost",
        message: "Device contact lost",
        occurredAt: now.toISOString(),
        actorId: null,
      });
      await this.audit.append({
        id: this.ids.uuid(),
        actorId: null,
        action: "incident.contact_lost",
        entityType: "Incident",
        entityId: incident.id,
        correlationId: incident.correlationId,
        requestId: null,
        metadata: {
          lastContactTime: last.toISOString(),
          lastLatitude: incident.lastLatitude,
          lastLongitude: incident.lastLongitude,
          lastSpeed: incident.lastSpeed,
          lastHeading: incident.lastHeading,
          lastBattery: incident.lastBattery,
        },
        createdAt: now,
      });
      this.publisher.publish("device.offline", {
        incidentId: incident.id,
        contactStatus: "DEVICE_CONTACT_LOST",
        lastContactTime: last.toISOString(),
        isTest: incident.isTest,
      });
      marked += 1;
    }
    return marked;
  }

  private async replay(actor: Actor, existing: IncidentRecord, requestHash: string): Promise<CreateIncidentResult> {
    if (existing.userId !== actor.id || existing.requestHash !== requestHash) {
      throw new AppError("IDEMPOTENCY_CONFLICT", 409, "This trigger was already used with a different payload.");
    }
    return { incident: toIncidentDto(existing), replayed: true, escalated: false };
  }

  private async requireReadable(actor: Actor, incidentId: string): Promise<IncidentRecord> {
    const incident = await this.requireKnown(incidentId);
    const operator = hasPermission(actor.role, Permission.IncidentReadActive);
    const owner = incident.userId === actor.id && hasPermission(actor.role, Permission.IncidentReadOwn);
    if (!operator && !owner) throw new AppError("FORBIDDEN", 403, "You cannot view this incident.");
    return incident;
  }

  private async requireWritableUpdate(actor: Actor, incidentId: string): Promise<IncidentRecord> {
    const incident = await this.requireKnown(incidentId);
    if (incident.userId !== actor.id || !hasPermission(actor.role, Permission.IncidentCreateOwn)) {
      throw new AppError("FORBIDDEN", 403, "You cannot update this incident.");
    }
    if (!ACTIVE_STATES.has(incident.state)) {
      throw new AppError("INCIDENT_CLOSED", 409, "This incident is no longer accepting updates.");
    }
    return incident;
  }

  private async requireKnown(incidentId: string): Promise<IncidentRecord> {
    const incident = await this.incidents.findById(incidentId);
    if (!incident) throw new AppError("NOT_FOUND", 404, "Incident not found.");
    return incident;
  }

  private assertTransition(incident: IncidentRecord, to: IncidentRecord["state"]): void {
    if (!canTransition(incident.state, to)) {
      throw new AppError("INVALID_TRANSITION", 409, `Cannot move an incident from ${incident.state} to ${to}.`);
    }
  }

  private async writeStateAudit(
    actor: Actor,
    incident: IncidentRecord,
    action: string,
    requestId: string | null,
    now: Date,
  ): Promise<void> {
    await this.audit.append({
      id: this.ids.uuid(),
      actorId: actor.id,
      action,
      entityType: "Incident",
      entityId: incident.id,
      correlationId: incident.correlationId,
      requestId,
      metadata: { state: incident.state, isTest: incident.isTest },
      createdAt: now,
    });
  }
}

export function toIncidentDto(incident: IncidentRecord): Incident {
  return {
    id: incident.id,
    userId: incident.userId,
    deviceId: incident.deviceId,
    triggerId: incident.triggerId,
    triggerType: incident.triggerType,
    state: incident.state,
    isTest: incident.isTest,
    duress: incident.duress,
    correlationId: incident.correlationId,
    protectionMode: incident.capsule.protectionMode,
    contactStatus: incident.contactStatus,
    contactLostAt: incident.contactLostAt?.toISOString() ?? null,
    lastHeartbeatAt: incident.lastHeartbeatAt?.toISOString() ?? null,
    lastLatitude: incident.lastLatitude,
    lastLongitude: incident.lastLongitude,
    lastAccuracy: incident.lastAccuracy,
    lastSpeed: incident.lastSpeed,
    lastHeading: incident.lastHeading,
    lastBattery: incident.lastBattery,
    distressCapsule: incident.capsule,
    userDisplayName: incident.userDisplayName,
    acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
  };
}
