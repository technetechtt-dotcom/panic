import assert from "node:assert/strict";
import test from "node:test";
import { recoveryPublicPayload } from "./email";

test("production recovery responses omit the token and the link", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const body = recoveryPublicPayload(true, { deepLink: "https://links.guardian.app/r/secret", devToken: "secret" });
    assert.deepEqual(body, { emailSent: true });
    assert.equal("devToken" in body, false);
    assert.equal("deepLink" in body, false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("development recovery responses keep the link for local testing", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    const body = recoveryPublicPayload(false, { devToken: "secret" });
    assert.equal(body.devToken, "secret");
  } finally {
    process.env.NODE_ENV = previous;
  }
});
