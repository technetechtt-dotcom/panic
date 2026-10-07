import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../app.module";
import {
  AUDIT_STORE,
  CONSENT_STORE,
  DEVICE_STORE,
  HEARTBEAT_STORE,
  INCIDENT_STORE,
  LOCATION_STORE,
  REFRESH_STORE,
  TIMELINE_STORE,
  USER_STORE,
} from "../common/tokens";
import { loadConfig } from "../config";
import { configureApp } from "../main";
import { createMemory } from "../testing/memory";

const capsule = {
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

async function createApp(): Promise<INestApplication> {
  const memory = createMemory();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(USER_STORE)
    .useValue(memory.users)
    .overrideProvider(REFRESH_STORE)
    .useValue(memory.refreshTokens)
    .overrideProvider(CONSENT_STORE)
    .useValue(memory.consents)
    .overrideProvider(DEVICE_STORE)
    .useValue(memory.devices)
    .overrideProvider(INCIDENT_STORE)
    .useValue(memory.incidents)
    .overrideProvider(LOCATION_STORE)
    .useValue(memory.locations)
    .overrideProvider(HEARTBEAT_STORE)
    .useValue(memory.heartbeats)
    .overrideProvider(TIMELINE_STORE)
    .useValue(memory.timeline)
    .overrideProvider(AUDIT_STORE)
    .useValue(memory.audit)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, loadConfig());
  await app.init();
  (app as INestApplication & { memory: ReturnType<typeof createMemory> }).memory = memory;
  return app;
}

function memoryOf(app: INestApplication): ReturnType<typeof createMemory> {
  return (app as INestApplication & { memory: ReturnType<typeof createMemory> }).memory;
}

test("authentication, SOS idempotency, and operator actions", async () => {
  const app = await createApp();
  try {
    const server = app.getHttpServer();
    const registered = await request(server).post("/api/v1/auth/register").send({
      email: "alex@example.com",
      password: "correct-horse-battery",
      displayName: "Alex",
      acceptedSafetyConsent: true,
    });
    assert.equal(registered.status, 201);
    const token = registered.body.data.accessToken as string;
    assert.equal(typeof token, "string");

    const rejected = await request(server).post("/api/v1/auth/register").send({
      email: "other@example.com",
      password: "short",
      displayName: "A",
      acceptedSafetyConsent: true,
    });
    assert.equal(rejected.status, 400);

    const me = await request(server).get("/api/v1/users/me").set("Authorization", `Bearer ${token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.role, "USER");

    const devicePublicId = randomUUID();
    const device = await request(server)
      .post("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .send({
        devicePublicId,
        platform: "ANDROID",
        osVersion: "15",
        appVersion: "0.1.0",
        fcmToken: "fcm-token-1",
      });
    assert.equal(device.status, 201);
    assert.equal(device.body.data.fcmToken, "fcm-token-1");
    const again = await request(server)
      .post("/api/v1/devices")
      .set("Authorization", `Bearer ${token}`)
      .send({
        devicePublicId,
        platform: "ANDROID",
        osVersion: "15",
        appVersion: "0.1.0",
        fcmToken: "fcm-token-2",
      });
    assert.equal(again.body.data.fcmToken, "fcm-token-2");

    const incidentBody = {
      triggerId: randomUUID(),
      correlationId: randomUUID(),
      triggerType: "MANUAL_SOS",
      deviceId: device.body.data.id,
      isTest: true,
      distressCapsule: capsule,
    };
    const created = await request(server)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${token}`)
      .send(incidentBody);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.state, "SOS");
    assert.equal(created.body.data.isTest, true);

    const replay = await request(server)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${token}`)
      .send(incidentBody);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.data.id, created.body.data.id);

    const fusion = await request(server)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...incidentBody, triggerId: randomUUID(), correlationId: randomUUID(), triggerType: "JOURNEY_TIMEOUT" });
    assert.equal(fusion.status, 422);
    assert.equal(fusion.body.error.code, "FUSION_NOT_ENABLED");

    const forbidden = await request(server)
      .post(`/api/v1/incidents/${created.body.data.id}/acknowledge`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(forbidden.status, 403);

    const user = [...memoryOf(app).users.rows.values()][0];
    assert.ok(user);
    user.role = "MONITOR_OPERATOR";

    const summary = await request(server).get("/api/v1/incidents/summary").set("Authorization", `Bearer ${token}`);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data.activeIncidents, 0);
    assert.equal(summary.body.data.highRiskAlerts, 0);
    assert.equal(summary.body.data.respondersActive, 0);

    const acknowledged = await request(server)
      .post(`/api/v1/incidents/${created.body.data.id}/acknowledge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "Practice incident reviewed" });
    assert.equal(acknowledged.status, 200);
    assert.equal(acknowledged.body.data.state, "ACKNOWLEDGED");

    const resolved = await request(server)
      .post(`/api/v1/incidents/${created.body.data.id}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.data.state, "RESOLVED");

    const timeline = await request(server)
      .get(`/api/v1/incidents/${created.body.data.id}/timeline`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(timeline.status, 200);
    assert.ok(timeline.body.data.some((entry: { type: string }) => entry.type === "incident.acknowledged"));
  } finally {
    await app.close();
  }
});
