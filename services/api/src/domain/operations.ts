import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const FUSION_POINTS: Record<string, number> = {
  ROUTE_DEVIATION: 10,
  MISSED_CHECK_IN: 20,
  WEARABLE_SEPARATION: 15,
  VEHICLE_SPEED_MOVEMENT: 10,
  NO_RESPONSE: 30,
};

/** Phone-confirmed fall and watch SOS open an incident. Other automatic types are server-only. */
export function signalIncidentState(triggerType: string): "SOS" | "CONCERN" | "HIGH_RISK" | null {
  if (triggerType === "FALL_OR_IMPACT" || triggerType === "WEARABLE") return "SOS";
  if (triggerType === "JOURNEY_TIMEOUT" || triggerType === "SAFETY_CHECK_FAILURE") return "CONCERN";
  if (triggerType === "SYSTEM_RISK_ESCALATION") return "HIGH_RISK";
  return null;
}

export function phoneMaySendSignal(triggerType: string): boolean {
  return triggerType === "FALL_OR_IMPACT" || triggerType === "WEARABLE";
}

export function fusionEvaluate(signals: string[]): { score: number; level: "NORMAL" | "CONCERN" | "HIGH_RISK"; reasons: string[] } {
  const reasons = signals.filter((signal) => FUSION_POINTS[signal] !== undefined);
  const score = reasons.reduce((sum, signal) => sum + (FUSION_POINTS[signal] ?? 0), 0);
  const level = score >= 40 ? "HIGH_RISK" : score >= 10 ? "CONCERN" : "NORMAL";
  return { score, level, reasons };
}

export function haversineMeters(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const radius = 6_371_000;
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function distanceToSegmentMeters(
  lat: number,
  lng: number,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): number {
  const startToEnd = haversineMeters(startLat, startLng, endLat, endLng);
  if (startToEnd < 1) return haversineMeters(lat, lng, startLat, startLng);
  const startToPoint = haversineMeters(startLat, startLng, lat, lng);
  const endToPoint = haversineMeters(endLat, endLng, lat, lng);
  const along = (startToEnd ** 2 + startToPoint ** 2 - endToPoint ** 2) / (2 * startToEnd);
  if (along <= 0) return startToPoint;
  if (along >= startToEnd) return endToPoint;
  return Math.sqrt(Math.max(0, startToPoint ** 2 - along ** 2));
}

export function routeDeviates(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  corridorMeters: number,
): boolean {
  return distanceToSegmentMeters(lat, lng, originLat, originLng, destLat, destLng) > corridorMeters;
}

export interface CorridorPoint {
  latitude: number;
  longitude: number;
  heading: number | null;
}

/** A search area around the last confirmed point. It is a hint for people, not a claim about where someone is. */
export function searchCorridor(points: CorridorPoint[]): { radiusMeters: number; polygon: Array<{ latitude: number; longitude: number }> } | null {
  const last = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)).at(-1);
  if (!last) return null;
  const heading = last.heading;
  const forward = heading === null ? 800 : 1500;
  const radiusMeters = heading === null ? 800 : 400;
  const bearings = heading === null
    ? [0, 45, 90, 135, 180, 225, 270, 315]
    : [heading - 25, heading - 12, heading, heading + 12, heading + 25, heading + 180];
  const distances = heading === null
    ? bearings.map(() => radiusMeters)
    : [forward, forward, forward, forward, forward, 200];
  return {
    radiusMeters,
    polygon: bearings.map((bearing, index) => destination(last.latitude, last.longitude, bearing, distances[index] ?? radiusMeters)),
  };
}

function destination(lat: number, lng: number, bearingDegrees: number, meters: number): { latitude: number; longitude: number } {
  const radius = 6_371_000;
  const bearing = ((bearingDegrees % 360) * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const angular = meters / radius;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: (lat2 * 180) / Math.PI, longitude: (((lng2 * 180) / Math.PI + 540) % 360) - 180 };
}

export function batterySurvival(mode: string): { locationIntervalMs: number; tickMs: number; audio: boolean; photo: boolean; video: boolean } {
  if (mode === "CRITICAL_ONLY") return { locationIntervalMs: 180_000, tickMs: 120_000, audio: true, photo: false, video: false };
  if (mode === "SURVIVAL") return { locationIntervalMs: 60_000, tickMs: 60_000, audio: true, photo: false, video: false };
  if (mode === "REDUCED") return { locationIntervalMs: 15_000, tickMs: 30_000, audio: true, photo: true, video: false };
  return { locationIntervalMs: 5_000, tickMs: 15_000, audio: true, photo: true, video: true };
}

export interface BriefInput {
  displayName: string;
  state: string;
  triggerType: string;
  duress: boolean;
  contactStatus: string;
  isTest: boolean;
  protectionMode: string;
  timeline: string[];
}

/** Rules over the timeline. This is not a model and it cannot cancel, accuse, or dispatch. */
export function incidentBrief(input: BriefInput): { summary: string; checks: string[] } {
  const checks = [
    input.duress ? "Treat a cancellation attempt as forced. Keep the incident open." : "Cancellation has not been flagged as duress.",
    input.contactStatus === "DEVICE_CONTACT_LOST" ? "The phone has stopped checking in. That is not proof the person is offline or hurt." : "The phone is still checking in.",
    input.isTest ? "This is a practice incident. Keep it out of live counts." : "This is a live incident.",
  ];
  const recent = input.timeline.slice(-3).join(" ");
  const summary = `${input.displayName} is in ${input.state} after ${input.triggerType} while protection was ${input.protectionMode}. ${recent}`.trim();
  return { summary, checks };
}

export function guardianSmsBody(input: { name: string; incidentState: string; roomUrl: string | null }): string {
  const room = input.roomUrl ? ` Open the private incident room: ${input.roomUrl}` : "";
  return `Guardian: ${input.name} needs help. Status ${input.incidentState}.${room} This message does not share evidence.`;
}

const TOTP_STEP = 30;

export function generateTotpSecret(): string {
  return randomBytes(20).toString("base64url");
}

export function totpCode(secret: string, counter: number): string {
  const key = Buffer.from(secret, "base64url");
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, nowMs: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(nowMs / 1000 / TOTP_STEP);
  const candidates = [counter - 1, counter, counter + 1].map((value) => totpCode(secret, value));
  const given = Buffer.from(code);
  return candidates.some((candidate) => {
    const expected = Buffer.from(candidate);
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

export function signMfaChallenge(secret: string, userId: string, expiresAtMs: number): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: expiresAtMs })).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function readMfaChallenge(secret: string, token: string, nowMs: number): string | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
  if (!parsed.sub || typeof parsed.exp !== "number" || parsed.exp < nowMs) return null;
  return parsed.sub;
}

export interface BackupDocument {
  version: 1;
  takenAt: string;
  tables: Record<string, number>;
}

export function backupDocument(takenAt: string, tables: Record<string, number>): BackupDocument {
  return { version: 1, takenAt, tables };
}

export function restoreMatches(saved: BackupDocument, current: Record<string, number>): boolean {
  return Object.entries(saved.tables).every(([table, count]) => current[table] === count);
}
