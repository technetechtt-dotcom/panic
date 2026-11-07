import type { IncidentState } from "@guardian/shared-types";

const TRANSITIONS: Record<IncidentState, readonly IncidentState[]> = {
  PROTECTED: [],
  CONCERN: ["HIGH_RISK", "SOS", "ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"],
  HIGH_RISK: ["SOS", "ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"],
  SOS: ["ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"],
  ACKNOWLEDGED: ["RESPONDING", "USER_LOCATED", "RESOLVED", "FALSE_ALARM"],
  RESPONDING: ["USER_LOCATED", "RESOLVED", "FALSE_ALARM"],
  USER_LOCATED: ["RESOLVED", "FALSE_ALARM"],
  RESOLVED: ["ARCHIVED"],
  FALSE_ALARM: ["ARCHIVED"],
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
