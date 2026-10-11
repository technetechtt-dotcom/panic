import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { DistressCapsule } from "@guardian/shared-types";
import { IncidentService } from "./incident-service";
import type { Actor, DeviceRecord, RealtimePublisher } from "./ports";
import { createMemory } from "../testing/memory";

const capsule: DistressCapsule = {
  timestamp: "2026-10-01T09:00:00.000Z",
  latitude: -26.2,
  longitude: 28.04,
  locationAccuracy: 10,
  speed: 0,
  heading: 90,
  batteryLevel: 70,
  chargingStatus: false,
  networkType: "CELLULAR",
  protectionMode: "NORMAL",
  duress: false,
  lastKnownLocation: null,
  appProtectionStatus: "LIMITED_PROTECTION",
};

test("concurrent SOS writes stay idempotent and a later heartbeat restores contact", async () => {
  const memory = createMemory();
  const publisher: RealtimePublisher = { publish() {} };
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
  const opened = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const actor: Actor = { id: randomUUID(), role: "USER", displayName: "Alex" };
      const device: DeviceRecord = {
        id: randomUUID(),
        userId: actor.id,
        devicePublicId: randomUUID(),
        platform: "ANDROID",
        manufacturer: null,
        model: "Pixel",
        osVersion: "15",
        appVersion: "0.1.0",
        createdAt: memory.clock.now(),
        updatedAt: memory.clock.now(),
      };
      await memory.devices.insert(device);
      const body = {
        triggerId: randomUUID(),
        correlationId: randomUUID(),
        triggerType: "MANUAL_SOS" as const,
        deviceId: device.id,
        isTest: false,
        distressCapsule: capsule,
      };
      const first = await service.create(actor, body, "load-1");
      const replay = await service.create(actor, body, "load-1");
      return { actor, first, replay };
    }),
  );
  assert.equal(opened.length, 20);
  assert.equal(new Set(opened.map((row) => row.first.incident.id)).size, 20);
  assert.ok(opened.every((row) => row.replay.replayed && row.replay.incident.id === row.first.incident.id));
  const { actor, first } = opened[0]!;
  memory.clock.current = new Date(memory.clock.now().getTime() + 120_000);
  assert.equal(await service.sweepStaleContacts(), 20);
  const lost = await service.get(actor, first.incident.id);
  assert.equal(lost.contactStatus, "DEVICE_CONTACT_LOST");
  assert.equal(lost.state, "SOS");
  await service.addHeartbeat(actor, first.incident.id, {
    clientHeartbeatId: randomUUID(),
    recordedAt: memory.clock.now().toISOString(),
    latitude: -26.2,
    longitude: 28.04,
    accuracy: 8,
    speed: 0,
    heading: 90,
    batteryLevel: 60,
    charging: false,
    networkType: "WIFI",
    deviceOnline: true,
    evidenceStatus: "NONE",
    permissionsStatus: "LOCATION_GRANTED",
    batteryMode: "NORMAL",
  }, null);
  const restored = await service.get(actor, first.incident.id);
  assert.equal(restored.contactStatus, "ONLINE");
});
