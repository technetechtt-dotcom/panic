import assert from "node:assert/strict";
import test from "node:test";
import {
  backupDocument,
  batterySurvival,
  fusionEvaluate,
  guardianSmsBody,
  incidentBrief,
  phoneMaySendSignal,
  readMfaChallenge,
  restoreMatches,
  routeDeviates,
  searchCorridor,
  signalIncidentState,
  signMfaChallenge,
  verifyTotp,
  totpCode,
} from "./operations";

test("fusion scores the same rules as the phone and does not invent a person", () => {
  const concern = fusionEvaluate(["ROUTE_DEVIATION"]);
  assert.equal(concern.level, "CONCERN");
  assert.equal(concern.score, 10);
  const high = fusionEvaluate(["MISSED_CHECK_IN", "NO_RESPONSE"]);
  assert.equal(high.level, "HIGH_RISK");
  assert.equal(fusionEvaluate(["NOT_A_SIGNAL"]).level, "NORMAL");
});

test("a confirmed fall or watch press can open SOS, and journey timeout cannot be posted by the phone", () => {
  assert.equal(signalIncidentState("FALL_OR_IMPACT"), "SOS");
  assert.equal(signalIncidentState("WEARABLE"), "SOS");
  assert.equal(phoneMaySendSignal("FALL_OR_IMPACT"), true);
  assert.equal(phoneMaySendSignal("JOURNEY_TIMEOUT"), false);
  assert.equal(signalIncidentState("JOURNEY_TIMEOUT"), "CONCERN");
  assert.equal(signalIncidentState("MANUAL_SOS"), null);
});

test("route deviation and the search corridor use the last confirmed point", () => {
  assert.equal(routeDeviates(-26.2, 28.05, -26.2, 28.04, -26.2, 28.08, 400), false);
  assert.equal(routeDeviates(-26.25, 28.04, -26.2, 28.04, -26.2, 28.08, 400), true);
  const corridor = searchCorridor([{ latitude: -26.2, longitude: 28.04, heading: 90 }]);
  assert.ok(corridor);
  assert.equal(corridor?.polygon.length, 6);
  assert.equal(searchCorridor([]), null);
});

test("battery survival keeps audio and slows location before the battery is empty", () => {
  assert.equal(batterySurvival("NORMAL").video, true);
  assert.equal(batterySurvival("SURVIVAL").photo, false);
  assert.equal(batterySurvival("SURVIVAL").audio, true);
  assert.ok(batterySurvival("CRITICAL_ONLY").locationIntervalMs > batterySurvival("NORMAL").locationIntervalMs);
});

test("the incident brief only restates known facts", () => {
  const brief = incidentBrief({
    displayName: "Alex",
    state: "SOS",
    triggerType: "MANUAL_SOS",
    duress: true,
    contactStatus: "ONLINE",
    isTest: false,
    protectionMode: "WALK",
    timeline: ["Manual SOS detected"],
  });
  assert.match(brief.summary, /Alex/);
  assert.match(brief.checks[0] ?? "", /forced/);
});

test("guardian SMS names the room and does not include evidence", () => {
  const body = guardianSmsBody({ name: "Alex", incidentState: "SOS", roomUrl: "https://hub.example/room/token" });
  assert.match(body, /private incident room/);
  assert.match(body, /does not share evidence/);
});

test("operator MFA accepts the current code and rejects a stale challenge", () => {
  const secret = "test-secret-that-is-long-enough-for-hs256";
  const code = totpCode("AAAA", Math.floor(1_700_000_000 / 30));
  assert.equal(verifyTotp("AAAA", code, 1_700_000_000_000), true);
  assert.equal(verifyTotp("AAAA", "000000", 1_700_000_000_000), false);
  const token = signMfaChallenge(secret, "user-1", 5_000);
  assert.equal(readMfaChallenge(secret, token, 4_000), "user-1");
  assert.equal(readMfaChallenge(secret, token, 5_001), null);
});

test("a backup document restores only when the table counts match", () => {
  const saved = backupDocument("2026-10-02T00:00:00.000Z", { User: 2, Incident: 1 });
  assert.equal(restoreMatches(saved, { User: 2, Incident: 1 }), true);
  assert.equal(restoreMatches(saved, { User: 2, Incident: 0 }), false);
});
