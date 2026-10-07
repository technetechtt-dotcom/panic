import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { DistressCapsule } from "@guardian/shared-types";
import { AppError } from "./errors";
import { IncidentService } from "./incident-service";
import { ProtectionService, type EvidenceStore, type GuardianStore, type JourneyRecord, type JourneyStore, type PinStore, type RiskStore, type TrustedContactRecord } from "./protection-service";
import { ScryptPasswordHasher } from "./security";
import { SimulatedSmsProvider } from "./sms";
import { createMemory } from "../testing/memory";

const capsule: DistressCapsule = {
  timestamp: "2026-10-01T09:00:00.000Z",
  latitude: null,
  longitude: null,
  locationAccuracy: null,
  speed: null,
  heading: null,
  batteryLevel: 50,
  chargingStatus: false,
  networkType: "WIFI",
  protectionMode: "NORMAL",
  duress: false,
  lastKnownLocation: null,
  appProtectionStatus: "PROTECTED",
};

test("guardians stay least privilege and a missed journey does not create an SOS", async () => {
  const memory = createMemory();
  const sms = new SimulatedSmsProvider();
  const guardians = new MemoryGuardians();
  const journeys = new MemoryJourneys();
  const risks = new MemoryRisks();
  const protection = new ProtectionService(
    guardians,
    journeys,
    risks,
    new MemoryPins(),
    new MemoryEvidence(),
    memory.incidents,
    memory.timeline,
    memory.audit,
    { publish() {} },
    new ScryptPasswordHasher(),
    memory.ids,
    memory.clock,
  );
  const actor = { id: randomUUID(), role: "USER" as const, displayName: "Alex" };
  const contact = await protection.addGuardian(actor, { displayName: "Sam", email: "sam@example.com", canViewLocation: false, canViewEvidence: false }, null);
  assert.equal(contact.canCancelIncident, false);
  assert.equal(contact.canViewLocation, false);
  assert.equal(contact.invitationStatus, "PENDING");
  const guardian = { id: randomUUID(), role: "GUARDIAN" as const, displayName: "Sam" };
  const accepted = await protection.acceptInvitation(guardian, contact.invitationToken!);
  assert.equal(accepted.invitationStatus, "ACCEPTED");
  assert.equal(accepted.guardianUserId, guardian.id);
  const journey = await protection.startJourney(actor, {
    destinationLabel: "Home",
    expectedArrivalAt: new Date(memory.clock.now().getTime() - 1000).toISOString(),
    checkInIntervalSeconds: 60,
  });
  const originalArrival = journey.expectedArrivalAt.getTime();
  memory.clock.current = new Date(memory.clock.now().getTime() + 120_000);
  const raised = await protection.sweepJourneys();
  assert.equal(raised, 1);
  assert.equal((await journeys.find(journey.id, actor.id))?.status, "CONCERN");
  assert.equal(memory.incidents.rows.size, 0);
  assert.equal(sms.recorded.length, 0);
  const second = await protection.sweepJourneys();
  assert.equal(second, 0);
  const extended = await protection.extendJourney(actor, journey.id, 20);
  assert.equal(extended.expectedArrivalAt.getTime(), originalArrival + 20 * 60_000);
});

test("duress keeps the incident open while a cancel pin resolves it, and evidence checks the hash", async () => {
  const memory = createMemory();
  const events: string[] = [];
  const pins = new MemoryPins();
  const evidence = new MemoryEvidence();
  const protection = new ProtectionService(
    new MemoryGuardians(),
    new MemoryJourneys(),
    new MemoryRisks(),
    pins,
    evidence,
    memory.incidents,
    memory.timeline,
    memory.audit,
    { publish(name) { events.push(name); } },
    new ScryptPasswordHasher(),
    memory.ids,
    memory.clock,
  );
  const actor = { id: randomUUID(), role: "USER" as const, displayName: "Alex" };
  const incidents = new IncidentService(
    memory.incidents,
    memory.devices,
    memory.locations,
    memory.heartbeats,
    memory.timeline,
    memory.audit,
    { publish() {} },
    memory.ids,
    memory.clock,
    45,
  );
  const deviceId = randomUUID();
  await memory.devices.insert({
    id: deviceId,
    userId: actor.id,
    devicePublicId: randomUUID(),
    platform: "ANDROID",
    manufacturer: null,
    model: null,
    osVersion: "15",
    appVersion: "0.1.0",
    createdAt: memory.clock.now(),
    updatedAt: memory.clock.now(),
  });
  const created = await incidents.create(actor, {
    triggerId: randomUUID(),
    correlationId: randomUUID(),
    triggerType: "MANUAL_SOS",
    deviceId,
    isTest: false,
    distressCapsule: capsule,
  }, null);
  await protection.setPins(actor, { cancelPin: "1234", duressPin: "9876" });
  const quiet = await protection.cancel(actor, created.incident.id, { pin: "9876" }, null);
  assert.equal(quiet.appearance, "CANCELLED");
  assert.equal((await memory.incidents.findById(created.incident.id))?.state, "SOS");
  assert.equal((await memory.incidents.findById(created.incident.id))?.duress, true);
  assert.equal(events.includes("duress.detected"), true);
  const bytes = Buffer.from("audio");
  const stored = await protection.addEvidence(actor, created.incident.id, {
    clientChunkId: randomUUID(),
    sequence: 0,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "audio/pcm",
    bytesBase64: bytes.toString("base64"),
  });
  assert.equal(stored.byteLength, bytes.length);
  await assert.rejects(
    () => protection.addEvidence(actor, created.incident.id, {
      clientChunkId: randomUUID(),
      sequence: 1,
      sha256: "a".repeat(64),
      contentType: "audio/pcm",
      bytesBase64: bytes.toString("base64"),
    }),
    (error: unknown) => error instanceof AppError && error.code === "EVIDENCE_HASH_MISMATCH",
  );
});

class MemoryGuardians implements GuardianStore {
  readonly rows: TrustedContactRecord[] = [];
  async insert(contact: TrustedContactRecord) { this.rows.push(contact); }
  async list(userId: string) { return this.rows.filter((row) => row.userId === userId); }
  async remove(id: string, userId: string) {
    const before = this.rows.length;
    const next = this.rows.filter((row) => !(row.id === id && row.userId === userId));
    this.rows.splice(0, this.rows.length, ...next);
    return next.length !== before;
  }
  async findByInvitationToken(token: string) {
    return this.rows.find((row) => row.invitationToken === token) ?? null;
  }
  async save(contact: TrustedContactRecord) {
    const index = this.rows.findIndex((row) => row.id === contact.id);
    if (index >= 0) this.rows[index] = contact;
  }
}

class MemoryJourneys implements JourneyStore {
  readonly rows = new Map<string, JourneyRecord>();
  async insert(journey: JourneyRecord) { this.rows.set(journey.id, journey); }
  async find(id: string, userId: string) {
    const row = this.rows.get(id);
    return row && row.userId === userId ? row : null;
  }
  async save(journey: JourneyRecord) { this.rows.set(journey.id, journey); }
  async listActive() { return [...this.rows.values()].filter((row) => row.status !== "COMPLETED"); }
}

class MemoryRisks implements RiskStore {
  readonly keys = new Set<string>();
  async record(signal: { sessionId: string; type: string }) {
    const key = `${signal.sessionId}:${signal.type}`;
    if (this.keys.has(key)) return "exists" as const;
    this.keys.add(key);
    return "created" as const;
  }
}

class MemoryPins implements PinStore {
  row: { userId: string; cancelPinHash: string; duressPinHash: string } | null = null;
  async get(userId: string) { return this.row && this.row.userId === userId ? this.row : null; }
  async save(record: { userId: string; cancelPinHash: string; duressPinHash: string }) { this.row = record; }
}

class MemoryEvidence implements EvidenceStore {
  readonly rows: Array<{ clientChunkId: string }> = [];
  async insert(chunk: { clientChunkId: string }) {
    if (this.rows.some((row) => row.clientChunkId === chunk.clientChunkId)) return "exists" as const;
    this.rows.push(chunk);
    return "created" as const;
  }
  async list() { return []; }
}
