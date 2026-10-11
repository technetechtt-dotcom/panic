export interface GeoResult {
  latitude: number;
  longitude: number;
  label: string;
}

export async function geocodeDestination(
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<GeoResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (env.NODE_ENV === "test" && !env.GEOCODER_FORCE) return null;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  const response = await fetchImpl(url, {
    headers: { "User-Agent": env.GEOCODER_USER_AGENT?.trim() || "Guardian/0.1 (journey-protection)" },
  }).catch(() => null);
  if (!response?.ok) return null;
  const rows = (await response.json().catch(() => [])) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const row = rows[0];
  const latitude = Number(row?.lat);
  const longitude = Number(row?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, label: row.display_name || trimmed };
}
