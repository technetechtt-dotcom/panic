import type { DistressCapsule, Incident, NetworkType, ProtectionMode } from "@guardian/shared-types";
import { parseNarrowband, type NarrowbandFields } from "@guardian/shared-validation";
import type { CreateIncidentInput } from "@guardian/shared-validation";
import { AppError } from "./errors";
import type { IncidentService } from "./incident-service";
import { macMatches, narrowbandMac } from "./public-safety";
import type { NarrowbandStore } from "./narrowband-store";
import type { Clock, UserStore } from "./ports";
import { openSecret } from "./security";

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 2 * 60 * 1000;

export class NarrowbandIngress {
  constructor(
    private readonly channels: NarrowbandStore,
    private readonly users: UserStore,
    private readonly incidents: IncidentService,
    private readonly notify: (incident: Incident) => Promise<void>,
    private readonly sealKey: string,
    private readonly clock: Clock,
  ) {}

  acceptSms(message: string): Promise<{ incidentId: string; replayed: boolean; escalated: boolean }> {
    return this.accept(message, "SMS", null);
  }

  acceptSatellite(imei: string, payload: string): Promise<{ incidentId: string; replayed: boolean; escalated: boolean }> {
    return this.accept(payload, "SATELLITE", imei);
  }

  private async accept(
    message: string,
    channel: "SMS" | "SATELLITE",
    imei: string | null,
  ): Promise<{ incidentId: string; replayed: boolean; escalated: boolean }> {
    const text = decodePayload(message);
    const parsed = parseNarrowband(text);
    if (!parsed) throw new AppError("VALIDATION", 422, "That SMS or satellite frame is not a Guardian SOS.");
    const record = channel === "SATELLITE"
      ? await this.channels.findByImei(imei ?? "")
      : await this.channels.findByPublicId(parsed.fields.devicePublicId);
    if (!record || record.revoked) {
      throw new AppError("DEVICE_NOT_FOUND", 404, "No registered phone matches this SMS or satellite modem.");
    }
    if (channel === "SATELLITE" && record.devicePublicId !== parsed.fields.devicePublicId) {
      throw new AppError("DEVICE_NOT_FOUND", 404, "The satellite modem is not bound to the phone named in the message.");
    }
    if (!record.keySeal) {
      throw new AppError("NARROWBAND_KEY_MISSING", 401, "This phone has no narrowband key. Refresh the emergency credential on a data connection.");
    }
    if (this.sealKey.length < 32) {
      throw new AppError("NOT_CONFIGURED", 503, "Narrowband SOS cannot be checked until the encryption key is configured.");
    }
    const secret = Buffer.from(openSecret(record.keySeal, this.sealKey), "base64url");
    const expected = narrowbandMac(secret, parsed.canonical);
    if (!macMatches(expected, parsed.macHex)) {
      throw new AppError("UNAUTHENTICATED", 401, "The SMS or satellite signature was not accepted.");
    }
    const age = this.clock.now().getTime() - parsed.fields.unixSeconds * 1000;
    if (age > MAX_AGE_MS || age < -MAX_FUTURE_MS) {
      throw new AppError("DEVICE_PROOF_EXPIRED", 401, "That SOS is outside the window for SMS and satellite delivery.");
    }
    const user = await this.users.findById(record.userId);
    if (!user) throw new AppError("NOT_FOUND", 404, "The person who owns this phone was not found.");
    const input = toIncidentInput(parsed.fields, record.deviceId, channel);
    const result = await this.incidents.create(
      { id: user.id, role: "USER", displayName: user.displayName, emergencyDeviceId: record.deviceId },
      input,
      null,
      true,
    );
    if (!result.replayed) await this.notify(result.incident);
    return { incidentId: result.incident.id, replayed: result.replayed, escalated: result.escalated };
  }
}

export function decodePayload(payload: string): string {
  const trimmed = payload.trim();
  if (trimmed.startsWith("G1.")) return trimmed;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, "hex").toString("utf8").trim();
  }
  return trimmed;
}

function toIncidentInput(
  fields: NarrowbandFields,
  deviceId: string,
  channel: "SMS" | "SATELLITE",
): CreateIncidentInput {
  const recordedAt = new Date(fields.unixSeconds * 1000).toISOString();
  const networkType: NetworkType = channel === "SATELLITE" ? "SATELLITE" : "NO_INTERNET";
  const protectionMode: ProtectionMode = fields.duress ? "HIGH_RISK" : "CUSTOM";
  const live = fields.lastKnown ? null : fields.latitude;
  const liveLng = fields.lastKnown ? null : fields.longitude;
  const capsule: DistressCapsule = {
    timestamp: recordedAt,
    latitude: live,
    longitude: liveLng,
    locationAccuracy: fields.accuracyMeters,
    speed: null,
    heading: null,
    batteryLevel: fields.batteryPercent,
    chargingStatus: fields.charging,
    networkType,
    protectionMode,
    duress: fields.duress || fields.triggerType === "DURESS",
    lastKnownLocation: fields.lastKnown && fields.latitude !== null && fields.longitude !== null
      ? {
          latitude: fields.latitude,
          longitude: fields.longitude,
          accuracy: fields.accuracyMeters,
          recordedAt,
        }
      : null,
    appProtectionStatus: "LIMITED_PROTECTION",
  };
  return {
    triggerId: fields.triggerId,
    triggerType: fields.triggerType,
    correlationId: fields.triggerId,
    deviceId,
    isTest: fields.isTest,
    distressCapsule: capsule,
  };
}
