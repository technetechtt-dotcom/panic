import { distanceToSegmentMeters } from "./operations";
export interface RoutePoint { latitude: number; longitude: number }
export async function roadRoute(from: RoutePoint, to: RoutePoint, env: NodeJS.ProcessEnv = process.env): Promise<RoutePoint[] | null> {
  const endpoint = env.ROUTER_URL?.trim();
  if (!endpoint) return null;
  const url = new URL(`${endpoint.replace(/\/$/, "")}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`);
  url.searchParams.set("overview", "full"); url.searchParams.set("geometries", "geojson");
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const result = await response.json() as { routes?: Array<{ geometry?: { coordinates?: unknown } }> };
  const coordinates = result.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 10000) return null;
  const points: RoutePoint[] = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || Math.abs(pair[0]) > 180 || Math.abs(pair[1]) > 90) return null;
    points.push({ latitude: pair[1], longitude: pair[0] });
  }
  return points;
}
export function distanceToRoute(latitude: number, longitude: number, route: RoutePoint[]): number {
  return route.slice(1).reduce((distance, end, index) => Math.min(distance, distanceToSegmentMeters(latitude, longitude, route[index]!.latitude, route[index]!.longitude, end.latitude, end.longitude)), Infinity);
}
