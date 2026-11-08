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
  const base = env.GEOCODER_URL?.trim() || "https://nominatim.openstreetmap.org/search";
  const url = new URL(base);
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


export interface RoutePoint { latitude: number; longitude: number }

export async function routedPolyline(
  origin: RoutePoint,
  destination: RoutePoint,
  profile: "driving" | "walking" = "driving",
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<RoutePoint[] | null> {
  if (env.NODE_ENV === "test" && !env.ROUTER_FORCE) return null;
  const configured = env.ROUTER_URL?.trim();
  if (!configured) return null;
  const base = configured.replace(/\/$/, "");
  const url = new URL(`${base}/${profile}/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  const response = await fetchImpl(url, { headers: { "User-Agent": env.GEOCODER_USER_AGENT?.trim() || "Guardian/0.1 (journey-protection)" }, signal: AbortSignal.timeout(7000) }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { routes?: Array<{ geometry?: { coordinates?: unknown } }> } | null;
  const coordinates = body?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const points = coordinates.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const longitude = Number(pair[0]); const latitude = Number(pair[1]);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  }).filter((point): point is RoutePoint => point !== null);
  if (points.length < 2) return null;
  if (points.length <= 500) return points;
  const stride = Math.ceil(points.length / 500);
  const sampled = points.filter((_, index) => index % stride === 0);
  if (sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1)!);
  return sampled;
}
