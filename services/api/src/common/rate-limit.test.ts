import assert from "node:assert/strict";
import test from "node:test";
import { SlidingWindowRateLimiter } from "./rate-limit";

test("rate limiter blocks the next call inside the window and allows it after the window", () => {
  const limiter = new SlidingWindowRateLimiter();
  assert.equal(limiter.allow("login", 2, 1_000, 0), true);
  assert.equal(limiter.allow("login", 2, 1_000, 10), true);
  assert.equal(limiter.allow("login", 2, 1_000, 20), false);
  assert.equal(limiter.allow("login", 2, 1_000, 1_100), true);
});
