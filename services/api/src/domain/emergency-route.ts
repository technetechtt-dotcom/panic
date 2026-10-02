export function emergencyRouteAllowed(method: string, path: string): boolean {
  const normalised = path.split("?")[0];
  if (method === "POST" && normalised === "/api/v1/incidents") return true;
  if (method === "GET" && /^\/api\/v1\/incidents\/[^/]+$/.test(normalised)) return true;
  return method === "POST" && /^\/api\/v1\/incidents\/[^/]+\/(locations|heartbeats|evidence)$/.test(normalised);
}
