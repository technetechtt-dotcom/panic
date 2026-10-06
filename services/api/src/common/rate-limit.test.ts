import assert from "node:assert/strict";
import test from "node:test";
import { allowShared, SlidingWindowRateLimiter } from "./rate-limit";

test("rate limiter blocks the next call inside the window and allows it after the window", () => {
  const limiter = new SlidingWindowRateLimiter();
  assert.equal(limiter.allow("login", 2, 1_000, 0), true);
  assert.equal(limiter.allow("login", 2, 1_000, 10), true);
  assert.equal(limiter.allow("login", 2, 1_000, 20), false);
  assert.equal(limiter.allow("login", 2, 1_000, 1_100), true);
});

test("shared limiter uses redis and falls back when redis throws", async () => {
  const memory = new SlidingWindowRateLimiter();
  const counts = new Map<string, number>();
  const redis = {
    async incr(key: string) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async pexpire() {
      return 1;
    },
  };
  assert.equal(await allowShared(redis, memory, "sos", 1, 1000), true);
  assert.equal(await allowShared(redis, memory, "sos", 1, 1000), false);
  assert.equal(await allowShared({ async incr() { throw new Error("down"); }, async pexpire() { return 0; } }, memory, "other", 1, 1000), true);
});
