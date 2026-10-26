import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config";

const base = {
  JWT_ACCESS_SECRET: "test-secret-that-is-long-enough-for-hs256",
  DATABASE_URL: "postgresql://guardian:change-me@127.0.0.1:5432/guardian",
};

test("production refuses incomplete configuration", () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "production" }), /EVIDENCE_VAULT_KEY/);
  assert.throws(
    () =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        EVIDENCE_VAULT_KEY: "vault-key-independent-32-chars-min",
      }),
    /CORS_ORIGIN/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        EVIDENCE_VAULT_KEY: "vault-key-independent-32-chars-min",
        CORS_ORIGIN: "https://hub.example.com",
      }),
    /PUBLIC_API_URL/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        EVIDENCE_VAULT_KEY: "vault-key-independent-32-chars-min",
        CORS_ORIGIN: "https://hub.example.com",
        PUBLIC_API_URL: "https://api.example.com",
        FCM_PROJECT_ID: "proj",
      }),
    /FCM/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        EVIDENCE_VAULT_KEY: "vault-key-independent-32-chars-min",
        CORS_ORIGIN: "https://hub.example.com",
        PUBLIC_API_URL: "https://api.example.com",
      }),
    /REDIS_URL/,
  );
  const config = loadConfig({
    ...base,
    NODE_ENV: "production",
    EVIDENCE_VAULT_KEY: "vault-key-independent-32-chars-min",
    CORS_ORIGIN: "https://hub.example.com",
    PUBLIC_API_URL: "https://api.example.com",
    REDIS_URL: "redis://redis:6379",
    TRUST_PROXY: "true",
    SMTP_URL: "smtps://mailer:secret@smtp.example.com:465",
  });
  assert.equal(config.corsOrigins[0], "https://hub.example.com");
  assert.equal(config.redisUrl, "redis://redis:6379");
  assert.equal(config.trustProxy, true);
});
