import assert from "node:assert/strict";
import test from "node:test";
import { evidenceVaultKey } from "./evidence-vault";
import { apnsHealth, fcmHealth, sendFcm, smsHealth } from "./sms";

test("FCM HTTP v1 is required and a legacy server key is degraded", async () => {
  assert.equal(smsHealth({}), "NOT_CONFIGURED");
  assert.equal(fcmHealth({}), "NOT_CONFIGURED");
  assert.equal(fcmHealth({ FCM_SERVER_KEY: "legacy" }), "DEGRADED");
  assert.equal(
    fcmHealth({
      FCM_PROJECT_ID: "proj",
      FCM_CLIENT_EMAIL: "sa@proj.iam.gserviceaccount.com",
      FCM_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    }),
    "CONFIGURED",
  );
  assert.equal(apnsHealth({}), "NOT_CONFIGURED");
  assert.equal(apnsHealth({ APNS_KEY_ID: "ABC", APNS_TEAM_ID: "TEAM" }), "NOT_IMPLEMENTED");
  const result = await sendFcm("token", "Guardian", "help", { FCM_SERVER_KEY: "legacy" });
  assert.equal(result.delivered, false);
  assert.match(result.reason, /HTTP v1|Legacy FCM|not configured|FCM/i);
});

test("production evidence vault key cannot fall back to the JWT secret", () => {
  assert.throws(
    () => evidenceVaultKey({ NODE_ENV: "production" }, "jwt-secret-that-is-long-enough-32chars", "production"),
    /EVIDENCE_VAULT_KEY/,
  );
  assert.equal(
    evidenceVaultKey({ EVIDENCE_VAULT_KEY: "vault-key-independent-32-chars-min" }, "jwt-secret-that-is-long-enough-32chars", "production"),
    "vault-key-independent-32-chars-min",
  );
});
