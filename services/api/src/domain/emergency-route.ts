export function emergencyRequestPath(path: string, originalUrl = ""): string {
  const original = originalUrl.split("?")[0];
  if (original.startsWith("/api/v1/")) return original;
  const clean = path.split("?")[0];
  if (clean.startsWith("/api/v1/")) return clean;
  if (clean.startsWith("/")) return `/api/v1${clean}`;
  return clean;
}

export function emergencyRouteAllowed(method: string, path: string): boolean {
  const normalised = path.split("?")[0];
  if (method === "POST" && normalised === "/api/v1/incidents") return true;
  if (method === "GET" && /^\/api\/v1\/incidents\/[^/]+$/.test(normalised)) return true;
  return method === "POST" && /^\/api\/v1\/incidents\/[^/]+\/(locations|heartbeats|evidence)$/.test(normalised);
}
