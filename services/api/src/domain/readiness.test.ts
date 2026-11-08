import assert from "node:assert/strict";
import test from "node:test";
import { byteRange } from "./byte-range";
import { distanceToRoute } from "./routing";
import { generateTotpSecret, totpCode } from "./operations";
import { FileEvidenceVault } from "./evidence-vault";
import { evidenceChunkSchema } from "@guardian/shared-validation";

test("ranges reject invalid requests and support suffixes and clipped ends", () => {
  assert.deepEqual(byteRange(undefined, 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange("bytes=10-20", 100), { start: 10, end: 20 });
  assert.deepEqual(byteRange("bytes=-5", 100), { start: 95, end: 99 });
  assert.deepEqual(byteRange("bytes=90-999", 100), { start: 90, end: 99 });
  for (const range of ["bytes=-0", "bytes=100-", "bytes=10-5", "bytes=1-2,3-4", "bytes=-", "garbage", "bytes=9007199254740999-"]) assert.equal(byteRange(range, 100), null);
});
test("new MFA secrets are standard Base32 and match the RFC test vector", () => {
  assert.match(generateTotpSecret(), /^[A-Z2-7]{32}$/);
  assert.equal(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1), "287082");
});
test("road corridor follows a bent routed polyline", () => {
  const route = [{ latitude: 0, longitude: 0 }, { latitude: .01, longitude: 0 }, { latitude: .01, longitude: .01 }];
  assert.ok(distanceToRoute(.01, .005, route) < 1);
  assert.ok(distanceToRoute(.005, .005, route) > 500);
});
test("capture validation rejects out-of-bounds chunk indices", () => {
  const data = { clientChunkId: "77b756f4-d7c5-4fd5-9b30-af4ceff31d82", sequence: 0, sha256: "a".repeat(64), contentType: "video/mp4", bytesBase64: "dGVzdA==", capture: { captureId: "77b756f4-d7c5-4fd5-9b30-af4ceff31d83", chunkIndex: 2, chunkCount: 2, originalSize: 8, originalSha256: "b".repeat(64), capturedAt: "2026-11-08T10:00:00.000Z" } };
  assert.equal(evidenceChunkSchema.safeParse(data).success, false);
  data.capture.chunkIndex = 1;
  assert.equal(evidenceChunkSchema.safeParse(data).success, true);
});
test("remote storage probe writes, reads and deletes an isolated encrypted object", async () => {
  const previous = { ...process.env }; const originalFetch = globalThis.fetch;
  const methods: string[] = []; let stored = Buffer.alloc(0);
  Object.assign(process.env, { S3_BUCKET: "test-bucket", S3_ENDPOINT: "https://objects.example.invalid", S3_ACCESS_KEY_ID: "test-id", S3_SECRET_ACCESS_KEY: "test-secret" });
  globalThis.fetch = (async (_url, init) => {
    const method = init?.method ?? "GET"; methods.push(method);
    if (method === "PUT") { stored = Buffer.from(init?.body as Uint8Array); return new Response(null, { status: 200 }); }
    if (method === "GET") return new Response(new Uint8Array(stored));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    const result = await new FileEvidenceVault("/tmp/unused-probe", "test-only-independent-evidence-vault-key").probeRemote();
    assert.equal(result.ok, true); assert.deepEqual(methods, ["PUT", "GET", "DELETE"]);
    assert.equal(stored.includes(Buffer.from("guardian-isolated-storage-probe")), false);
  } finally { globalThis.fetch = originalFetch; for (const key of ["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});
