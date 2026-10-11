import assert from "node:assert/strict";
import test from "node:test";
import { geocodeDestination } from "./geocode";

test("journey geocoding is skipped in test unless forced, then stores coordinates", async () => {
  const skipped = await geocodeDestination("Cape Town", { NODE_ENV: "test" }, async () => {
    throw new Error("Nominatim must not be called in the default test path.");
  });
  assert.equal(skipped, null);

  const geo = await geocodeDestination(
    "Cape Town Station",
    { NODE_ENV: "test", GEOCODER_FORCE: "1", GEOCODER_USER_AGENT: "Guardian-test" },
    async (input) => {
      const url = String(input);
      assert.match(url, /nominatim\.openstreetmap\.org/);
      return new Response(JSON.stringify([{ lat: "-33.9249", lon: "18.4241", display_name: "Cape Town Station" }]), {
        status: 200,
      });
    },
  );
  assert.deepEqual(geo, { latitude: -33.9249, longitude: 18.4241, label: "Cape Town Station" });
});
