import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { deliveryStatusFromTwilio, verifyTwilioSignature } from "./delivery";

test("Twilio and push receipts map to delivery statuses", () => {
  assert.equal(deliveryStatusFromTwilio("delivered"), "DELIVERED");
  assert.equal(deliveryStatusFromTwilio("failed"), "FAILED");
  assert.equal(deliveryStatusFromTwilio("undelivered"), "FAILED");
  assert.equal(deliveryStatusFromTwilio("sent"), "SENT");
  const url = "https://api.example.com/api/v1/webhooks/twilio/sms";
  const body = { MessageSid: "SM123", MessageStatus: "delivered" };
  const data = url + Object.keys(body).sort().map((key) => key + body[key as keyof typeof body]).join("");
  const signature = createHmac("sha1", "token").update(data).digest("base64");
  assert.equal(verifyTwilioSignature(url, body, signature, "token"), true);
  assert.equal(verifyTwilioSignature(url, body, "nope", "token"), false);
});
