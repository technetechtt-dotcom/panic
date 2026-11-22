import type { TriggerType } from "@guardian/shared-types";

/** One GSM-7 SMS segment, also the Iridium SBD payload. The prefix is what the MAC covers. */
export const NARROWBAND_MAX_CHARS = 160;

const TRIGGER_CODES = {
  M: "MANUAL_SOS",
  V: "VOLUME_BUTTON",
  W: "VOICE_SAFE_WORD",
  D: "DURESS",
  F: "FALL_OR_IMPACT",
  R: "WEARABLE",
  J: "JOURNEY_TIMEOUT",
  S: "SAFETY_CHECK_FAILURE",
  Y: "SYSTEM_RISK_ESCALATION",
} as const satisfies Record<string, TriggerType>;

const CODE_BY_TRIGGER = Object.fromEntries(
  Object.entries(TRIGGER_CODES).map(([code, trigger]) => [trigger, code]),
) as Record<TriggerType, string>;

export interface NarrowbandFields {
  devicePublicId: string;
  triggerId: string;
  triggerType: TriggerType;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  batteryPercent: number | null;
  duress: boolean;
  charging: boolean;
  isTest: boolean;
  lastKnown: boolean;
  unixSeconds: number;
}

export interface ParsedNarrowband {
  canonical: string;
  macHex: string;
  fields: NarrowbandFields;
}

export function uuidToHex(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

export function hexToUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function coord(value: number | null): string {
  if (value === null) return "X";
  return String(Math.round(value * 1e5));
}

function small(value: number | null, max: number): string {
  if (value === null) return "X";
  return String(Math.min(max, Math.max(0, Math.round(value))));
}

export function canonicalNarrowband(fields: NarrowbandFields): string {
  const code = CODE_BY_TRIGGER[fields.triggerType];
  if (!code) throw new Error("This trigger cannot travel on SMS or satellite.");
  let flags = 0;
  if (fields.duress) flags |= 0b0001;
  if (fields.charging) flags |= 0b0010;
  if (fields.isTest) flags |= 0b0100;
  if (fields.lastKnown) flags |= 0b1000;
  return [
    "G1",
    uuidToHex(fields.devicePublicId),
    uuidToHex(fields.triggerId),
    code,
    coord(fields.latitude),
    coord(fields.longitude),
    small(fields.accuracyMeters, 9999),
    small(fields.batteryPercent, 100),
    flags.toString(16).toUpperCase().padStart(2, "0"),
    String(Math.trunc(fields.unixSeconds)),
  ].join(".");
}

export function formatNarrowband(canonical: string, macHex: string): string {
  const message = `${canonical}.${macHex.toLowerCase()}`;
  if (message.length > NARROWBAND_MAX_CHARS) {
    throw new Error("The narrowband SOS does not fit in one SMS segment.");
  }
  return message;
}

export function parseNarrowband(message: string): ParsedNarrowband | null {
  const parts = message.trim().split(".");
  if (parts.length !== 11 || parts[0] !== "G1") return null;
  const macHex = parts[10]?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{16}$/.test(macHex)) return null;
  const [pub, trig, code, lat, lng, acc, bat, flags, unix] = parts.slice(1, 10);
  if (!pub || !trig || !/^[0-9a-f]{32}$/.test(pub) || !/^[0-9a-f]{32}$/.test(trig)) return null;
  const triggerType = TRIGGER_CODES[code as keyof typeof TRIGGER_CODES];
  if (!triggerType || !flags || !/^[0-9A-Fa-f]{2}$/.test(flags) || !unix || !/^\d{9,10}$/.test(unix)) return null;
  const latitude = readCoord(lat, 90);
  const longitude = readCoord(lng, 180);
  if (latitude === undefined || longitude === undefined) return null;
  if ((latitude === null) !== (longitude === null)) return null;
  const accuracyMeters = readSmall(acc, 9999);
  const batteryPercent = readSmall(bat, 100);
  if (accuracyMeters === undefined || batteryPercent === undefined) return null;
  const bits = Number.parseInt(flags, 16);
  return {
    canonical: parts.slice(0, 10).join("."),
    macHex,
    fields: {
      devicePublicId: hexToUuid(pub),
      triggerId: hexToUuid(trig),
      triggerType,
      latitude,
      longitude,
      accuracyMeters,
      batteryPercent,
      duress: (bits & 0b0001) !== 0,
      charging: (bits & 0b0010) !== 0,
      isTest: (bits & 0b0100) !== 0,
      lastKnown: (bits & 0b1000) !== 0,
      unixSeconds: Number(unix),
    },
  };
}

function readCoord(value: string | undefined, limit: number): number | null | undefined {
  if (!value || value === "X") return value === "X" ? null : undefined;
  if (!/^-?\d{1,8}$/.test(value)) return undefined;
  const degrees = Number(value) / 1e5;
  if (degrees < -limit || degrees > limit) return undefined;
  return degrees;
}

function readSmall(value: string | undefined, max: number): number | null | undefined {
  if (!value || value === "X") return value === "X" ? null : undefined;
  if (!/^\d{1,4}$/.test(value)) return undefined;
  const parsed = Number(value);
  if (parsed > max) return undefined;
  return parsed;
}

/** WebCrypto ECDSA signatures are raw r||s. Android and Node expect DER. */
export function ecdsaP1363ToDer(signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new Error("An ECDSA P-256 signature is 64 bytes.");
  const r = derInteger(signature.slice(0, 32));
  const s = derInteger(signature.slice(32));
  const body = new Uint8Array(r.length + s.length);
  body.set(r, 0);
  body.set(s, r.length);
  const sequence = new Uint8Array(2 + body.length);
  sequence[0] = 0x30;
  sequence[1] = body.length;
  sequence.set(body, 2);
  return sequence;
}

function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const needsPad = (bytes[start] ?? 0) & 0x80;
  const length = bytes.length - start + (needsPad ? 1 : 0);
  const out = new Uint8Array(2 + length);
  out[0] = 0x02;
  out[1] = length;
  if (needsPad) out[2] = 0;
  out.set(bytes.slice(start), needsPad ? 3 : 2);
  return out;
}
