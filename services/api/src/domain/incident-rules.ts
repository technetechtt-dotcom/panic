import type { IncidentState } from "@guardian/shared-types";

const TRANSITIONS: Record<IncidentState, readonly IncidentState[]> = {
  PROTECTED: [],
  CONCERN: ["HIGH_RISK", "SOS", "ACKNOWLEDGED", "RESOLVED"],
  HIGH_RISK: ["SOS", "ACKNOWLEDGED", "RESOLVED"],
  SOS: ["ACKNOWLEDGED", "RESOLVED"],
  ACKNOWLEDGED: ["RESPONDING", "USER_LOCATED", "RESOLVED"],
  RESPONDING: ["USER_LOCATED", "RESOLVED"],
  USER_LOCATED: ["RESOLVED"],
  RESOLVED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: IncidentState, to: IncidentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function contactDecision(
  lastContactAt: Date,
  now: Date,
  staleAfterSeconds: number,
  current: "ONLINE" | "DEVICE_CONTACT_LOST",
): "ONLINE" | "DEVICE_CONTACT_LOST" {
  const stale = now.getTime() - lastContactAt.getTime() >= staleAfterSeconds * 1000;
  if (stale) return "DEVICE_CONTACT_LOST";
  return current === "DEVICE_CONTACT_LOST" ? "ONLINE" : "ONLINE";
}

export function isStale(lastContactAt: Date, now: Date, staleAfterSeconds: number): boolean {
  return now.getTime() - lastContactAt.getTime() >= staleAfterSeconds * 1000;
}
