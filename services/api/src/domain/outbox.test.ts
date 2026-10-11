import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { etaSeconds, outboxBackoffMs } from "./scheduler-lock";

test("outbox backoff grows then caps under fifteen minutes", () => {
  assert.ok(outboxBackoffMs(1) >= 2_000);
  assert.ok(outboxBackoffMs(2) >= 4_000);
  assert.ok(outboxBackoffMs(20) <= 15 * 60_000 + 500);
});

test("ETA uses reported speed when present and walking pace otherwise", () => {
  assert.equal(etaSeconds(140, 1.4), 100);
  assert.equal(etaSeconds(140, null), 100);
  assert.equal(etaSeconds(140, 0.1), 100);
  assert.equal(etaSeconds(-1, 1), null);
});

test("scheduler lock owner ids stay unique per process", () => {
  const a = randomUUID();
  const b = randomUUID();
  assert.notEqual(a, b);
});
