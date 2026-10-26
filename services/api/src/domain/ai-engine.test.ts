import assert from "node:assert/strict";
import test from "node:test";
import { answerQuestion, assessThreat, govern, searchAreas, shiftHandoverSummary, type AiFacts } from "./ai-engine";

const now = Date.parse("2026-10-26T09:00:00.000Z");

function facts(overrides: Partial<AiFacts> = {}): AiFacts {
  return {
    displayName: "Amina",
    triggerType: "MANUAL_SOS",
    state: "SOS",
    duress: false,
    isTest: false,
    contactStatus: "ONLINE",
    protectionMode: "FULL",
    lastLatitude: -26.2,
    lastLongitude: 28.04,
    lastHeading: 90,
    lastSpeed: 1,
    lastAccuracy: 20,
    lastBattery: 0.8,
    lastHeartbeatAt: "2026-10-26T08:59:30.000Z",
    contactLostAt: null,
    acknowledgedAt: null,
    locationCount: 2,
    evidenceCount: 0,
    guardianTotal: 1,
    guardianAcked: 0,
    responders: [{ name: "Sam", distanceMeters: 1200, status: "EN_ROUTE" }],
    timeline: ["SOS accepted", "Location stored"],
    nowMs: now,
    ...overrides,
  };
}

test("an explicit SOS stays an emergency after assessment", () => {
  const result = assessThreat(facts());
  assert.equal(result.level, "EMERGENCY");
  assert.equal(result.mode, "PRODUCTION");
  assert.ok(result.explanation.includes("not delayed"));
  assert.ok(result.recommendations.every((item) => item.action !== "CANCEL_INCIDENT"));
});

test("duress is critical and a shadow model cannot lower an open SOS", () => {
  const live = facts({ duress: true, triggerType: "DURESS", contactStatus: "DEVICE_CONTACT_LOST" });
  assert.equal(assessThreat(live).level, "CRITICAL");
  assert.equal(assessThreat(live, "SHADOW").level, "CRITICAL");
  const concern = facts({
    triggerType: "JOURNEY_TIMEOUT",
    state: "CONCERN",
    contactStatus: "DEVICE_CONTACT_LOST",
    duress: false,
    guardianTotal: 0,
    guardianAcked: 0,
  });
  assert.equal(assessThreat(concern).level, "CONCERN");
  assert.equal(assessThreat(concern, "SHADOW").level, "HIGH_RISK");
});

test("governance drops any action outside the human-approval list", () => {
  const kept = govern([
    { action: "CANCEL_INCIDENT", reason: "must not survive" },
    { action: "KEEP_INCIDENT_OPEN", reason: "operator decides" },
  ]);
  assert.deepEqual(kept.map((item) => item.action), ["KEEP_INCIDENT_OPEN"]);
});

test("copilot quotes the confirmed fix and refuses to invent a position", () => {
  const placed = answerQuestion(facts(), "Where was the last confirmed location?");
  assert.match(placed.answer, /-26\.20000, 28\.04000/);
  assert.match(placed.answer, /not a prediction/);
  const missing = answerQuestion(facts({ lastLatitude: null, lastLongitude: null }), "where is the person");
  assert.match(missing.answer, /No confirmed location/);
});

test("search output separates confirmed, estimated, and predicted areas", () => {
  const areas = searchAreas(facts());
  assert.deepEqual(areas.map((area) => area.kind), ["CONFIRMED_AREA", "ESTIMATED_AREA", "PREDICTED_AREA"]);
  assert.match(areas[2]!.label, /Predicted only/);
  assert.equal(searchAreas(facts({ lastLatitude: null })).length, 0);
});

test("handover summary lists open live incidents and ignores practice rows", () => {
  const text = shiftHandoverSummary({
    operatorName: "Operator",
    incidents: [
      { displayName: "Amina", state: "SOS", triggerType: "MANUAL_SOS", duress: true, isTest: false },
      { displayName: "Practice", state: "SOS", triggerType: "MANUAL_SOS", duress: false, isTest: true },
    ],
    deadLetters: 2,
    providerNotes: ["SMS is not configured."],
  });
  assert.match(text, /Amina: SOS/);
  assert.match(text, /2 notification dead letter/);
  assert.equal(text.includes("Practice"), false);
});
