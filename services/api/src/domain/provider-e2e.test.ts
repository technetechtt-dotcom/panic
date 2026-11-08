import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { deliveryStatusFromTwilio, verifyTwilioSignature } from "./delivery";
import { sendTransactionalEmail } from "./email";
import { TwilioSmsProvider, sendApns, sendFcm } from "./sms";

test("provider delivery callbacks are verified before a status is applied", () => {
  const url = "https://api.example.com/api/v1/webhooks/twilio/sms";
  const body = { MessageSid: "SM-e2e", MessageStatus: "delivered" };
  const data = url + Object.keys(body).sort().map((key) => key + body[key as keyof typeof body]).join("");
  const signature = createHmac("sha1", "twilio-token").update(data).digest("base64");
  assert.equal(verifyTwilioSignature(url, body, signature, "twilio-token"), true);
  assert.equal(deliveryStatusFromTwilio(body.MessageStatus), "DELIVERED");
});

test("real Twilio, FCM, and APNs sends run only when credentials are injected", async (t) => {
  if (process.env.GUARDIAN_PROVIDER_E2E !== "1") {
    t.skip("Set GUARDIAN_PROVIDER_E2E=1 and provider credentials to send a real test message.");
    return;
  }
  for (const name of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "INTEGRATION_TEST_PHONE", "FCM_PROJECT_ID", "FCM_CLIENT_EMAIL", "FCM_PRIVATE_KEY", "FCM_TEST_TOKEN", "SMTP_URL", "INTEGRATION_TEST_EMAIL"]) assert.ok(process.env[name], `Missing real provider test configuration: ${name}`);
  const sms = await new TwilioSmsProvider().send({ to: process.env.INTEGRATION_TEST_PHONE!, body: "Guardian delivery test. No emergency is active.", incidentId: "integration-test" });
  assert.equal(sms.simulated, false); assert.equal(sms.delivered, true, sms.reason); assert.ok(sms.providerMessageId);
  assert.equal(await sendTransactionalEmail({ to: process.env.INTEGRATION_TEST_EMAIL!, subject: "Guardian delivery test", text: "No emergency is active. Confirm receipt in the release validation log." }), true);
  if (process.env.FCM_PROJECT_ID && process.env.FCM_TEST_TOKEN) {
    const push = await sendFcm(process.env.FCM_TEST_TOKEN, "Guardian test", "Delivery callback test");
    assert.equal(push.simulated, false);
    assert.equal(push.delivered, true, push.reason);
  }
  if (process.env.APNS_KEY_P8 && process.env.APNS_TEST_TOKEN) {
    const apple = await sendApns(process.env.APNS_TEST_TOKEN, "Guardian test", "Delivery callback test");
    assert.equal(apple.simulated, false);
    assert.equal(apple.delivered, true, apple.reason);
  }
});
