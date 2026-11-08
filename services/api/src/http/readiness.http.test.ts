import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../app.module";
import { configureApp } from "../main";
import { loadConfig } from "../config";
import { JwtAccessTokens, ScryptPasswordHasher, sealSecret, openSecret, sha256 } from "../domain/security";
import { generateTotpSecret, totpCode } from "../domain/operations";
import { PlatformService } from "../domain/platform-service";
import { OutboxService } from "../domain/outbox";

const password = "readiness-correct-horse-battery";
test("migrated RBAC, Guardian accounting, MFA, capture streaming, erasure, and outbox recovery", async t => {
  if (process.env.GUARDIAN_PG_TEST !== "1") { t.skip("Set GUARDIAN_PG_TEST=1 against an isolated migrated test database."); return; }
  const config = loadConfig();
  const prisma = new PrismaClient();
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication({ bodyParser: false });
  configureApp(app, config); await app.init();
  const server = app.getHttpServer();
  const users: Record<string, { id: string; token: string; email: string }> = {};
  const userIds: string[] = [];
  const issuer = new JwtAccessTokens(config.jwtSecret, 900);
  const hash = await new ScryptPasswordHasher().hash(password);
  let incidentId = "";
  try {
    for (const role of ["USER", "GUARDIAN", "RESPONDER", "ADMIN"] as const) {
      const id = randomUUID(); userIds.push(id); const email = `readiness-${id}@example.invalid`;
      await prisma.user.create({ data: { id, email, passwordHash: hash, displayName: `Readiness ${role}`, role, emailVerifiedAt: new Date() } });
      users[role] = { id, email, token: await issuer.sign({ id, role }) };
    }
    const owner = users.USER!; const guardian = users.GUARDIAN!; const responder = users.RESPONDER!; const admin = users.ADMIN!;
    const device = await prisma.device.create({ data: { id: randomUUID(), userId: owner.id, devicePublicId: randomUUID(), platform: "ANDROID", osVersion: "35", appVersion: "test", emergencyTokenHash: sha256("readiness-emergency-token"), fcmToken: "test-fcm-token" } });
    const capsule = { timestamp: new Date().toISOString(), latitude: null, longitude: null, locationAccuracy: null, speed: null, heading: null, batteryLevel: 50, chargingStatus: false, networkType: "WIFI", protectionMode: "NORMAL", duress: false, lastKnownLocation: null, appProtectionStatus: "PROTECTED" };
    const opened = await request(server).post("/api/v1/incidents").auth(owner.token, { type: "bearer" }).send({ triggerId: randomUUID(), correlationId: randomUUID(), deviceId: device.id, triggerType: "MANUAL_SOS", isTest: true, distressCapsule: capsule });
    assert.equal(opened.status, 201, JSON.stringify(opened.body)); incidentId = opened.body.data.id;
    await prisma.responderAssignment.create({ data: { id: randomUUID(), incidentId, responderId: responder.id, status: "ASSIGNED", assignedAt: new Date() } });
    for (const route of ["/incidents/summary", `/incidents/${incidentId}/evidence`, `/incidents/${incidentId}/deliveries`, "/operators/shifts/current"]) {
      const denied = await request(server).get(`/api/v1${route}`).auth(responder.token, { type: "bearer" }); assert.equal(denied.status, 403, route);
    }
    const assigned = await request(server).get("/api/v1/incidents").auth(responder.token, { type: "bearer" }); assert.equal(assigned.body.data[0].assignment, "ASSIGNED");
    const invalid = await request(server).post(`/api/v1/incidents/${incidentId}/responder-status`).auth(responder.token, { type: "bearer" }).send({ status: "ON_SCENE" }); assert.equal(invalid.status, 409);
    const contact = await prisma.trustedContact.create({ data: { id: randomUUID(), userId: owner.id, guardianUserId: guardian.id, displayName: "Guardian", invitationStatus: "ACCEPTED", active: true } });
    const other = await request(server).get(`/api/v1/guardian/incidents/${randomUUID()}/access`).auth(guardian.token, { type: "bearer" }); assert.equal(other.status, 404);
    const access = await request(server).get(`/api/v1/guardian/incidents/${incidentId}/access`).auth(guardian.token, { type: "bearer" }); assert.equal(access.status, 200);
    const token = access.body.data.roomUrl.split("/").at(-1);
    for (const [channel, status] of [["SMS", "FAILED"], ["FCM", "SENT"], ["ROOM", "SENT"], ["EMAIL", "SKIPPED"]]) await prisma.notificationDelivery.create({ data: { id: randomUUID(), incidentId, trustedContactId: contact.id, channel: channel!, status: status!, destination: "redacted", detail: "test" } });
    const ack = await request(server).post(`/api/v1/rooms/${token}/ack`).send({}); assert.equal(ack.status, 200); assert.match(ack.headers["cache-control"], /no-store/);
    assert.equal(await prisma.guardianAcknowledgement.count({ where: { incidentId } }), 1);
    const deliveryRows = await prisma.notificationDelivery.findMany({ where: { incidentId } }); assert.equal(deliveryRows.find(r => r.channel === "SMS")?.status, "FAILED"); assert.equal(deliveryRows.find(r => r.channel === "EMAIL")?.status, "SKIPPED");
    const platform = app.get(PlatformService);
    await prisma.incident.update({ where: { id: incidentId }, data: { isTest: false } });
    await prisma.notificationDelivery.updateMany({ where: { incidentId, channel: "FCM" }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    const metrics = await platform.reportsOverview({ id: admin.id, displayName: "Admin", role: "ADMIN" });
    assert.equal(metrics.guardianAcknowledgedUnique, 1); assert.equal(metrics.guardianNotifiedUnique, 1); assert.equal(metrics.guardianAcknowledgementRate, 100); assert.equal(metrics.guardianChannelDeliverySuccessRate, 50);
    const actor = { id: admin.id, displayName: "Admin", role: "ADMIN" as const };
    const oldSecret = generateTotpSecret();
    await prisma.operatorMfa.create({ data: { userId: admin.id, secret: sealSecret(oldSecret, config.mfaEncryptionKey), enabled: true } });
    await assert.rejects(() => platform.beginMfa(actor, { password: "wrong" }));
    const setup = await platform.beginMfa(actor, { password, currentCode: totpCode(oldSecret, Math.floor(Date.now() / 30000)) });
    const pending = await prisma.operatorMfa.findUniqueOrThrow({ where: { userId: admin.id } }); assert.equal(pending.enabled, true); assert.equal(openSecret(pending.secret, config.mfaEncryptionKey), oldSecret);
    assert.match(setup.secret, /^[A-Z2-7]{32}$/);
    await platform.confirmMfa(actor, totpCode(setup.secret, Math.floor(Date.now() / 30000)));
    const switched = await prisma.operatorMfa.findUniqueOrThrow({ where: { userId: admin.id } }); assert.equal(openSecret(switched.secret, config.mfaEncryptionKey), setup.secret); assert.equal(switched.pendingSecret, null);
    const bytes = Buffer.from("first capture header then continuation bytes"); const fullHash = createHash("sha256").update(bytes).digest("hex"); const captureId = randomUUID(); const capturedAt = new Date().toISOString();
    for (const [index, part] of [bytes.subarray(0, 14), bytes.subarray(14)].entries()) {
      const uploaded = await request(server).post(`/api/v1/incidents/${incidentId}/evidence`).auth(owner.token, { type: "bearer" }).send({ clientChunkId: randomUUID(), sequence: index, sha256: createHash("sha256").update(part).digest("hex"), contentType: "video/mp4", bytesBase64: part.toString("base64"), capture: { captureId, capturedAt, chunkIndex: index, chunkCount: 2, originalSize: bytes.length, originalSha256: fullHash } }); assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    }
    const artifact = await prisma.evidenceArtifact.findUniqueOrThrow({ where: { incidentId_captureId: { incidentId, captureId } } }); assert.ok(artifact.completedAt);
    const ranged = await request(server).get(`/api/v1/incidents/${incidentId}/artifacts/${artifact.id}/stream`).auth(admin.token, { type: "bearer" }).set("Range", "bytes=10-20").buffer(true).parse((res, done) => { const parts: Buffer[] = []; res.on("data", chunk => parts.push(chunk)); res.on("end", () => done(null, Buffer.concat(parts))); }); assert.equal(ranged.status, 206); assert.deepEqual(ranged.body, bytes.subarray(10, 21));
    const privateFile = await request(server).get(`/api/v1/incidents/${incidentId}/artifacts/${artifact.id}/stream`).auth(guardian.token, { type: "bearer" }); assert.equal(privateFile.status, 403);
    const communication = await request(server).post(`/api/v1/incidents/${incidentId}/communications`).auth(admin.token, { type: "bearer" }).send({ channel: "PHONE", type: "CONNECTED", note: "Called Guardian", externalReference: "case-123" }); assert.equal(communication.status, 200, JSON.stringify(communication.body));
    const id = randomUUID();
    await prisma.outboxEvent.create({ data: { id, type: "TEST", aggregateType: "Incident", aggregateId: incidentId, payload: {}, status: "PROCESSING", attempts: 0, maxAttempts: 2, nextAttemptAt: new Date(0), lockedAt: new Date(0), lockedBy: "crashed" } });
    const outbox = app.get(OutboxService); const recovered = await outbox.claimBatch("replacement-worker", 100); assert.ok(recovered.some(row => row.id === id)); await outbox.markSent(id);
    const dataExport = await request(server).get("/api/v1/users/me/export").auth(owner.token, { type: "bearer" }); assert.equal(dataExport.status, 200); assert.ok(Array.isArray(dataExport.body.data.incidents));
    const erased = await request(server).post("/api/v1/users/me/erase").auth(owner.token, { type: "bearer" }).send({ password }); assert.equal(erased.status, 200, JSON.stringify(erased.body));
    const revoked = await prisma.device.findUniqueOrThrow({ where: { id: device.id } }); assert.ok(revoked.revokedAt); assert.equal(revoked.fcmToken, null); assert.equal(revoked.emergencyTokenHash, null);
    const bearer = await request(server).get("/api/v1/users/me").auth(owner.token, { type: "bearer" }); assert.equal(bearer.status, 403);
    const emergency = await request(server).get("/api/v1/users/me").set("Authorization", "Emergency readiness-emergency-token"); assert.equal(emergency.status, 401);
  } finally {
    if (incidentId) await prisma.incident.deleteMany({ where: { id: incidentId } });
    await prisma.device.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close(); await prisma.$disconnect();
  }
});
