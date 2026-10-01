import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { DistressCapsule } from "@guardian/shared-types";
import type { CreateIncidentInput } from "@guardian/shared-validation";
import { AuthService } from "./auth-service";
import { AppError, UniqueConflictError } from "./errors";
import { IncidentService } from "./incident-service";
import { canTransition } from "./incident-rules";
import type { Actor, DeviceRecord, RealtimePublisher } from "./ports";
import { hasPermission, Permission } from "./rbac";
import { canonicalJson, JwtAccessTokens, redact, ScryptPasswordHasher, sha256 } from "./security";
import { SimulatedSmsProvider } from "./sms";
import { createMemory, type MemoryAudit } from "../testing/memory";

const capsule: DistressCapsule = {
  timestamp: "2026-10-01T09:00:00.000Z",
  latitude: -26.2041,
  longitude: 28.0473,
  locationAccuracy: 8,
  speed: 1.2,
  heading: 180,
  batteryLevel: 64,
  chargingStatus: false,
  networkType: "CELLULAR",
  protectionMode: "NORMAL",
  duress: false,
  lastKnownLocation: null,
  appProtectionStatus: "LIMITED_PROTECTION",
};

function userActor(id: string): Actor {
  return { id, role: "USER", displayName: "Alex" };
}

function operatorActor(): Actor {
  return { id: randomUUID(), role: "MONITOR_OPERATOR", displayName: "Operator" };
}

async function setup() {
  const memory = createMemory();
  const events: Array<{ name: string; payload: unknown }> = [];
  const publisher: RealtimePublisher = {
    publish(name, payload) {
      events.push({ name, payload });
    },
  };
  const service = new IncidentService(
    memory.incidents,
    memory.devices,
    memory.locations,
    memory.heartbeats,
    memory.timeline,
    memory.audit,
    publisher,
    memory.ids,
    memory.clock,
    45,
  );
  const actor = userActor(randomUUID());
  const device: DeviceRecord = {
    id: randomUUID(),
    userId: actor.id,
    devicePublicId: randomUUID(),
    platform: "ANDROID",
    manufacturer: "Google",
    model: "Pixel",
    osVersion: "15",
    appVersion: "0.1.0",
    createdAt: memory.clock.now(),
    updatedAt: memory.clock.now(),
  };
  await memory.devices.insert(device);
  const input = (): CreateIncidentInput => ({
    triggerId: randomUUID(),
    correlationId: randomUUID(),
    triggerType: "MANUAL_SOS",
    deviceId: device.id,
    isTest: false,
    distressCapsule: capsule,
  });
  return { memory, service, actor, device, input, events };
}

test("a deliberate manual SOS creates one incident immediately", async () => {
  const { service, actor, input, events } = await setup();
  const created = await service.create(actor, input(), null);
  assert.equal(created.replayed, false);
  assert.equal(created.incident.state, "SOS");
  assert.equal(created.incident.triggerType, "MANUAL_SOS");
  assert.equal(events[0]?.name, "incident.created");
  assert.equal(created.incident.duress, false);
});

test("non-deliberate triggers do not create an incident", async () => {
  const { service, actor, input } = await setup();
  await assert.rejects(
    () => service.create(actor, { ...input(), triggerType: "FALL_OR_IMPACT" }, null),
    (error: unknown) => error instanceof AppError && error.code === "FUSION_NOT_ENABLED",
  );
});

test("retrying the same SOS payload returns the original incident", async () => {
  const { service, actor, input } = await setup();
  const body = input();
  const first = await service.create(actor, body, null);
  const second = await service.create(actor, body, null);
  assert.equal(second.replayed, true);
  assert.equal(second.incident.id, first.incident.id);
});

test("the same trigger id with a different payload conflicts", async () => {
  const { service, actor, input } = await setup();
  const body = input();
  await service.create(actor, body, null);
  await assert.rejects(
    () => service.create(actor, { ...body, isTest: true }, null),
    (error: unknown) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("a unique-constraint race still resolves to one incident", async () => {
  const ctx = await setup();
  const body = ctx.input();
  const originalInsert = ctx.memory.incidents.insert.bind(ctx.memory.incidents);
  let calls = 0;
  ctx.memory.incidents.insert = async (incident) => {
    calls += 1;
    if (calls === 1) {
      await originalInsert(incident);
      throw new UniqueConflictError();
    }
    return originalInsert(incident);
  };
  const result = await ctx.service.create(ctx.actor, body, null);
  assert.equal(result.replayed, true);
  assert.equal(ctx.memory.incidents.rows.size, 1);
});

test("a user cannot acknowledge or read another person's incident", async () => {
  const { service, actor, input } = await setup();
  const created = await service.create(actor, input(), null);
  const operator = operatorActor();
  await assert.rejects(
    () => service.acknowledge(actor, created.incident.id, undefined, null),
    (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
  );
  await assert.rejects(
    () => service.get({ id: randomUUID(), role: "USER", displayName: "Other" }, created.incident.id),
    (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
  );
  const acknowledged = await service.acknowledge(operator, created.incident.id, "Calling guardians", null);
  assert.equal(acknowledged.state, "ACKNOWLEDGED");
  const resolved = await service.resolve(operator, created.incident.id, undefined, null);
  assert.equal(resolved.state, "RESOLVED");
  await assert.rejects(
    () => service.resolve(operator, created.incident.id, undefined, null),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_TRANSITION",
  );
});

test("location points append and duplicate uploads do not overwrite them", async () => {
  const { service, actor, input } = await setup();
  const created = await service.create(actor, input(), null);
  const newer = "2026-10-01T09:00:10.000Z";
  const older = "2026-10-01T08:59:50.000Z";
  const pointId = randomUUID();
  await service.addLocations(actor, created.incident.id, {
    points: [{
      clientPointId: pointId,
      latitude: -26.21,
      longitude: 28.05,
      accuracy: 5,
      speed: 4,
      bearing: 90,
      altitude: 1750,
      recordedAt: newer,
      source: "GPS",
    }],
  }, null);
  const second = await service.addLocations(actor, created.incident.id, {
    points: [
      {
        clientPointId: pointId,
        latitude: 0,
        longitude: 0,
        accuracy: 1,
        speed: 0,
        bearing: 0,
        altitude: 0,
        recordedAt: newer,
        source: "GPS",
      },
      {
        clientPointId: randomUUID(),
        latitude: -26.1,
        longitude: 28.0,
        accuracy: 20,
        speed: 0,
        bearing: 10,
        altitude: null,
        recordedAt: older,
        source: "NETWORK",
      },
    ],
  }, null);
  assert.deepEqual(second, { inserted: 1, duplicates: 1 });
  const points = await service.locationsFor(actor, created.incident.id);
      assert.equal(points.length, 2);
      assert.equal(points[0]?.latitude, -26.1);
      assert.equal(points[1]?.latitude, -26.21);
      const incident = await service.get(actor, created.incident.id);
      assert.equal(incident.lastLatitude, -26.21);
      assert.equal(incident.lastLongitude, 28.05);
});

test("a missed heartbeat is contact loss and not a conclusion about the user", async () => {
  const { service, actor, input, memory, events } = await setup();
  const created = await service.create(actor, { ...input(), isTest: true }, null);
  memory.clock.current = new Date("2026-10-01T09:01:00.000Z");
  const marked = await service.sweepStaleContacts();
  assert.equal(marked, 1);
  const incident = await service.get(actor, created.incident.id);
  assert.equal(incident.contactStatus, "DEVICE_CONTACT_LOST");
  assert.equal(incident.state, "SOS");
  assert.equal(events.some((event) => event.name === "device.offline"), true);
  const summary = await service.summary(operatorActor());
  assert.equal(summary.activeIncidents, 0);
  assert.equal(summary.devicesContactLost, 0);
  assert.equal(summary.highRiskAlerts, null);
});

test("a heartbeat restores contact and a duplicate heartbeat is ignored", async () => {
  const { service, actor, input, memory } = await setup();
  const created = await service.create(actor, input(), null);
  memory.clock.current = new Date("2026-10-01T09:01:00.000Z");
  await service.sweepStaleContacts();
  const heartbeatId = randomUUID();
  const heartbeat = {
    clientHeartbeatId: heartbeatId,
    recordedAt: "2026-10-01T09:01:05.000Z",
    latitude: -26.3,
    longitude: 28.1,
    accuracy: 6,
    speed: 12,
    heading: 40,
    batteryLevel: 40,
    charging: false,
    networkType: "WIFI" as const,
    deviceOnline: true,
    evidenceStatus: "NONE" as const,
    permissionsStatus: "LOCATION_GRANTED",
    batteryMode: "NORMAL" as const,
  };
  assert.equal((await service.addHeartbeat(actor, created.incident.id, heartbeat, null)).replayed, false);
  assert.equal((await service.addHeartbeat(actor, created.incident.id, heartbeat, null)).replayed, true);
  const incident = await service.get(actor, created.incident.id);
  assert.equal(incident.contactStatus, "ONLINE");
  assert.equal(incident.lastBattery, 40);
  const beats = await service.heartbeatsFor(actor, created.incident.id);
  assert.equal(beats.length, 1);
});

test("guardians and responders have no incident permissions in this version", () => {
  assert.equal(hasPermission("GUARDIAN", Permission.IncidentReadActive), false);
  assert.equal(hasPermission("RESPONDER", Permission.IncidentReadOwn), false);
  assert.equal(hasPermission("USER", Permission.IncidentAcknowledge), false);
  assert.equal(hasPermission("MONITOR_OPERATOR", Permission.IncidentResolve), true);
  assert.equal(canTransition("SOS", "ACKNOWLEDGED"), true);
  assert.equal(canTransition("RESOLVED", "SOS"), false);
});

test("refresh token reuse revokes the token family", async () => {
  const memory = createMemory();
  const hasher = new ScryptPasswordHasher();
  const tokens = new JwtAccessTokens("test-secret-that-is-long-enough-for-hs256", 900);
  const audit = async () => undefined;
  const auth = new AuthService(
    memory.users,
    memory.refreshTokens,
    memory.consents,
    hasher,
    tokens,
    memory.ids,
    memory.clock,
    30,
    900,
    audit,
  );
  const session = await auth.register({
    email: "alex@example.com",
    password: "correct-horse-battery",
    displayName: "Alex",
  });
  const rotated = await auth.refresh(session.refreshToken);
  assert.notEqual(rotated.refreshToken, session.refreshToken);
  await assert.rejects(
    () => auth.refresh(session.refreshToken),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_REFRESH",
  );
  assert.equal(await auth.refresh(rotated.refreshToken).then(() => true, () => false), false);
  assert.equal(memory.consents.rows.length, 1);
});

test("logs redact secrets and canonical hashes are stable", () => {
  const redacted = redact({ password: "secret", nested: { refreshToken: "abc" }, ok: 1 }) as {
    password: string;
    nested: { refreshToken: string };
  };
  assert.equal(redacted.password, "[redacted]");
  assert.equal(redacted.nested.refreshToken, "[redacted]");
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: 2 } }), canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
  assert.equal(sha256("a").length, 64);
});

test("the SMS simulator records a message and does not deliver it", async () => {
  const sms = new SimulatedSmsProvider();
  const result = await sms.send({ to: "+27000000000", body: "test", incidentId: "inc" });
  assert.equal(result.delivered, false);
  assert.equal(result.simulated, true);
  assert.equal(sms.recorded.length, 1);
});

test("failed login does not reveal whether the email exists beyond the shared message", async () => {
  const memory = createMemory();
  const auth = new AuthService(
    memory.users,
    memory.refreshTokens,
    memory.consents,
    new ScryptPasswordHasher(),
    new JwtAccessTokens("test-secret-that-is-long-enough-for-hs256", 900),
    memory.ids,
    memory.clock,
    30,
    900,
    async () => undefined,
  );
  await assert.rejects(
    () => auth.login({ email: "missing@example.com", password: "correct-horse-battery" }),
    (error: unknown) => error instanceof AppError && error.message === "Invalid email or password.",
  );
  const auditRows = (memory.audit as MemoryAudit).rows;
  assert.equal(auditRows.length, 0);
});
