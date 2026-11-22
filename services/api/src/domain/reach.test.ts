import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { canonicalNarrowband, formatNarrowband } from "@guardian/shared-validation";
import { NarrowbandIngress } from "./narrowband-ingress";
import type { NarrowbandRecord, NarrowbandStore } from "./narrowband-store";
import { IncidentService } from "./incident-service";
import { dispatchPublicSafety, macMatches, narrowbandMac, noonlightBody } from "./public-safety";
import type { DeviceRecord, RealtimePublisher } from "./ports";
import { createMemory } from "../testing/memory";

class MemoryChannels implements NarrowbandStore {
  readonly rows = new Map<string, NarrowbandRecord>();
  async saveKey(deviceId: string, userId: string, keySeal: string): Promise<boolean> {
    const row = [...this.rows.values()].find((item) => item.deviceId === deviceId && item.userId === userId);
    if (!row) return false;
    row.keySeal = keySeal;
    return true;
  }
  async clearKey(deviceId: string): Promise<void> {
    const row = [...this.rows.values()].find((item) => item.deviceId === deviceId);
    if (row) {
      row.keySeal = null;
      row.iridiumImei = null;
    }
  }
  async findByPublicId(devicePublicId: string): Promise<NarrowbandRecord | null> {
    return [...this.rows.values()].find((item) => item.devicePublicId === devicePublicId && !item.revoked) ?? null;
  }
  async findByImei(imei: string): Promise<NarrowbandRecord | null> {
    return [...this.rows.values()].find((item) => item.iridiumImei === imei && !item.revoked) ?? null;
  }
  async setImei(): Promise<"saved" | "missing" | "taken"> {
    return "saved";
  }
}

test("SMS and satellite frames open one incident and a bad MAC does not", async () => {
  const memory = createMemory();
  const userId = randomUUID();
  const deviceId = randomUUID();
  const devicePublicId = randomUUID();
  const now = new Date("2026-11-22T12:00:00.000Z");
  memory.clock.current = now;
  await memory.users.insert({
    id: userId,
    email: "ada@example.com",
    passwordHash: "hash",
    displayName: "Ada",
    role: "USER",
    phone: "+27110000000",
    createdAt: now,
    updatedAt: now,
  });
  const device: DeviceRecord = {
    id: deviceId,
    userId,
    devicePublicId,
    platform: "WEB",
    manufacturer: null,
    model: null,
    osVersion: "web",
    appVersion: "0.1.0",
    publicKey: null,
    fcmToken: null,
    revokedAt: null,
    lastSeenAt: now,
    pushTokenUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await memory.devices.insert(device);
  const credential = randomBytes(32).toString("base64url");
  const channels = new MemoryChannels();
  channels.rows.set(devicePublicId, {
    deviceId,
    userId,
    devicePublicId,
    keySeal: credential,
    iridiumImei: "300234010753370",
    revoked: false,
  });
  const events: string[] = [];
  const publisher: RealtimePublisher = { publish(name) { events.push(name); } };
  const incidents = new IncidentService(
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
    memory.users,
  );
  const notified: string[] = [];
  const ingress = new NarrowbandIngress(
    channels,
    memory.users,
    incidents,
    async (incident) => { notified.push(incident.id); },
    "test-secret-that-is-long-enough-for-hs256",
    memory.clock,
  );
  const triggerId = randomUUID();
  const canonical = canonicalNarrowband({
    devicePublicId,
    triggerId,
    triggerType: "MANUAL_SOS",
    latitude: -26.2041,
    longitude: 28.0473,
    accuracyMeters: 12,
    batteryPercent: 40,
    duress: false,
    charging: false,
    isTest: false,
    lastKnown: false,
    unixSeconds: Math.floor(now.getTime() / 1000),
  });
  const mac = narrowbandMac(Buffer.from(credential, "base64url"), canonical);
  const message = formatNarrowband(canonical, mac);
  const opened = await ingress.acceptSms(message);
  const again = await ingress.acceptSms(message);
  assert.equal(again.incidentId, opened.incidentId);
  assert.equal(again.replayed, true);
  assert.equal(notified.length, 1);
  assert.equal(events.includes("incident.created"), true);
  await assert.rejects(() => ingress.acceptSms(`${canonical}.${"00".repeat(8)}`), /signature was not accepted/);
  const satelliteTrigger = randomUUID();
  const satelliteCanonical = canonicalNarrowband({
    devicePublicId,
    triggerId: satelliteTrigger,
    triggerType: "DURESS",
    latitude: -26.2,
    longitude: 28.04,
    accuracyMeters: 30,
    batteryPercent: 15,
    duress: true,
    charging: false,
    isTest: false,
    lastKnown: false,
    unixSeconds: Math.floor(now.getTime() / 1000),
  });
  const satelliteMac = createHmac("sha256", Buffer.from(credential, "base64url")).update(satelliteCanonical).digest("hex").slice(0, 16);
  assert.equal(macMatches(satelliteMac, satelliteMac), true);
  const satellite = await ingress.acceptSatellite("300234010753370", Buffer.from(formatNarrowband(satelliteCanonical, satelliteMac), "utf8").toString("hex"));
  assert.equal(satellite.escalated, true);
  assert.equal(satellite.incidentId, opened.incidentId);
  const escalated = await memory.incidents.findById(opened.incidentId);
  assert.equal(escalated?.duress, true);
  assert.ok(escalated);
  escalated.state = "RESOLVED";
  await memory.incidents.save(escalated);
  const freshTrigger = randomUUID();
  const freshCanonical = canonicalNarrowband({
    devicePublicId,
    triggerId: freshTrigger,
    triggerType: "MANUAL_SOS",
    latitude: -26.21,
    longitude: 28.05,
    accuracyMeters: 20,
    batteryPercent: 11,
    duress: false,
    charging: false,
    isTest: false,
    lastKnown: false,
    unixSeconds: Math.floor(now.getTime() / 1000),
  });
  const freshMac = narrowbandMac(Buffer.from(credential, "base64url"), freshCanonical);
  const fresh = await ingress.acceptSatellite("300234010753370", formatNarrowband(freshCanonical, freshMac));
  const stored = await memory.incidents.findById(fresh.incidentId);
  assert.equal(fresh.replayed, false);
  assert.equal(stored?.capsule.networkType, "SATELLITE");
  await assert.rejects(() => ingress.acceptSatellite("300234010753371", formatNarrowband(freshCanonical, freshMac)), /No registered phone/);
});

test("public safety dispatch is explicit and does not invent a call", async () => {
  const request = {
    incidentId: randomUUID(),
    correlationId: randomUUID(),
    service: "EMS" as const,
    name: "Ada",
    phone: "+27 11 000 0000",
    latitude: -26.2,
    longitude: 28.05,
    accuracy: 8,
    duress: true,
    note: "Unconscious",
    medical: { bloodType: "O+", allergies: "penicillin", medications: null },
  };
  const unconfigured = await dispatchPublicSafety(request, {});
  assert.equal(unconfigured.status, "NOT_CONFIGURED");
  assert.equal(unconfigured.dial, "112");
  assert.match(unconfigured.detail, /did not place that call/);
  const body = noonlightBody(request);
  const services = body.services as { medical: boolean; police: boolean; fire: boolean };
  assert.equal(services.medical, true);
  assert.equal(services.police, false);
  let called = "";
  const dispatched = await dispatchPublicSafety(request, {
    NOONLIGHT_API_URL: "https://dispatch.example.test",
    NOONLIGHT_API_TOKEN: "token-that-is-long-enough",
  }, async (url, init) => {
    called = String(url);
    assert.equal(init?.method, "POST");
    assert.match(String(init?.headers && (init.headers as Record<string, string>).authorization), /^Bearer /);
    return new Response(JSON.stringify({ id: "alarm-1" }), { status: 201 });
  });
  assert.equal(called, "https://dispatch.example.test/dispatch/v1/alarms");
  assert.equal(dispatched.status, "DISPATCHED");
  assert.equal(dispatched.reference, "alarm-1");
  assert.equal(dispatched.provider, "NOONLIGHT");
  const noFix = await dispatchPublicSafety({ ...request, latitude: null, longitude: null }, {
    NOONLIGHT_API_URL: "https://dispatch.example.test",
    NOONLIGHT_API_TOKEN: "token-that-is-long-enough",
  }, async () => {
    throw new Error("should not be called");
  });
  assert.equal(noFix.status, "FAILED");
});
