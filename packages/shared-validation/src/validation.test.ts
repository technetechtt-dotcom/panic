import assert from "node:assert/strict";
import test from "node:test";
import {
  createIncidentSchema,
  distressCapsuleByteLength,
  isDeliberateTrigger,
  MAX_DISTRESS_CAPSULE_BYTES,
  registerSchema,
} from "./index";

const capsule = {
  timestamp: "2026-10-01T09:00:00.000Z",
  latitude: -26.2041,
  longitude: 28.0473,
  locationAccuracy: 12,
  speed: 0,
  heading: 90,
  batteryLevel: 80,
  chargingStatus: false,
  networkType: "CELLULAR",
  protectionMode: "NORMAL",
  duress: false,
  lastKnownLocation: null,
  appProtectionStatus: "LIMITED_PROTECTION",
};

test("registration requires consent and a long password", () => {
  assert.equal(registerSchema.safeParse({
    email: "a@example.com",
    password: "short",
    displayName: "A",
    acceptedSafetyConsent: true,
  }).success, false);

  assert.equal(registerSchema.safeParse({
    email: "a@example.com",
    password: "a-long-password",
    displayName: "A",
    acceptedSafetyConsent: false,
  }).success, false);
});

test("deliberate triggers are recognised and extra incident fields are rejected", () => {
  assert.equal(isDeliberateTrigger("MANUAL_SOS"), true);
  assert.equal(isDeliberateTrigger("FALL_OR_IMPACT"), false);
  const parsed = createIncidentSchema.safeParse({
    triggerId: "8d8a6a2e-6c3d-4a1e-9e2a-0d5b9c1f4a77",
    triggerType: "MANUAL_SOS",
    deviceId: "2b6d5c1a-1e2f-4c3b-8a90-7d6e5f4a3b21",
    isTest: true,
    distressCapsule: capsule,
    role: "ADMIN",
  });
  assert.equal(parsed.success, false);
});

test("a distress capsule stays under the priority size budget", () => {
  assert.ok(distressCapsuleByteLength(capsule) < MAX_DISTRESS_CAPSULE_BYTES);
  assert.ok(distressCapsuleByteLength(capsule) < 800);
});
