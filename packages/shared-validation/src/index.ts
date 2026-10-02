import { z } from "zod";
import {
  DELIBERATE_TRIGGER_TYPES,
  LOCATION_SOURCES,
  NETWORK_TYPES,
  PROTECTION_MODES,
  PROTECTION_STATUSES,
  TRIGGER_TYPES,
} from "@guardian/shared-types";

export const MAX_DISTRESS_CAPSULE_BYTES = 2048;
export const MAX_INCIDENT_BODY_BYTES = 8192;
export const MAX_LOCATION_BATCH = 20;

const isoTime = z.string().datetime({ offset: true });

export const registerSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(1).max(80),
    acceptedSafetyConsent: z.literal(true),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(20).max(512).optional(),
  })
  .strict();

export const deviceRegistrationSchema = z
  .object({
    devicePublicId: z.string().uuid(),
    platform: z.literal("ANDROID"),
    manufacturer: z.string().trim().max(80).optional(),
    model: z.string().trim().max(80).optional(),
    osVersion: z.string().trim().min(1).max(40),
    appVersion: z.string().trim().min(1).max(40),
    publicKey: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(32).max(512).optional(),
  })
  .strict();

function requireCoordinatePair(
  value: { latitude: number | null; longitude: number | null },
  ctx: z.RefinementCtx,
): void {
  if ((value.latitude === null) !== (value.longitude === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Latitude and longitude must both be present or both be absent.",
    });
  }
}

export const lastKnownLocationSchema = z
  .object({
    latitude: z.number().gte(-90).lte(90),
    longitude: z.number().gte(-180).lte(180),
    accuracy: z.number().nonnegative().nullable(),
    recordedAt: isoTime,
  })
  .strict();

export const distressCapsuleSchema = z
  .object({
    timestamp: isoTime,
    latitude: z.number().gte(-90).lte(90).nullable(),
    longitude: z.number().gte(-180).lte(180).nullable(),
    locationAccuracy: z.number().nonnegative().nullable(),
    speed: z.number().min(-1).max(200).nullable(),
    heading: z.number().min(0).max(360).nullable(),
    batteryLevel: z.number().min(0).max(100).nullable(),
    chargingStatus: z.boolean(),
    networkType: z.enum(NETWORK_TYPES),
    protectionMode: z.enum(PROTECTION_MODES),
    duress: z.boolean(),
    lastKnownLocation: lastKnownLocationSchema.nullable(),
    appProtectionStatus: z.enum(PROTECTION_STATUSES),
  })
  .strict()
  .superRefine(requireCoordinatePair);

export const deviceProofSchema = z
  .object({
    algorithm: z.literal("SHA256withECDSA"),
    signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(16).max(200),
    signedAt: isoTime,
  })
  .strict();

export const createIncidentSchema = z
  .object({
    triggerId: z.string().uuid(),
    triggerType: z.enum(TRIGGER_TYPES),
    correlationId: z.string().uuid(),
    deviceId: z.string().uuid(),
    isTest: z.boolean(),
    confidence: z.number().min(0).max(1).optional(),
    protectionSessionId: z.string().uuid().optional(),
    metadata: z.record(z.string().max(40), z.union([z.string().max(120), z.number(), z.boolean()])).optional(),
    deviceProof: deviceProofSchema.optional(),
    distressCapsule: distressCapsuleSchema,
  })
  .strict();

export const locationPointSchema = z
  .object({
    clientPointId: z.string().uuid(),
    latitude: z.number().gte(-90).lte(90),
    longitude: z.number().gte(-180).lte(180),
    accuracy: z.number().nonnegative().nullable(),
    speed: z.number().min(-1).max(200).nullable(),
    bearing: z.number().min(0).max(360).nullable(),
    altitude: z.number().min(-500).max(10000).nullable(),
    recordedAt: isoTime,
    source: z.enum(LOCATION_SOURCES),
  })
  .strict();

export const locationBatchSchema = z
  .object({
    points: z.array(locationPointSchema).min(1).max(MAX_LOCATION_BATCH),
  })
  .strict();

export const heartbeatSchema = z
  .object({
    clientHeartbeatId: z.string().uuid(),
    recordedAt: isoTime,
    latitude: z.number().gte(-90).lte(90).nullable(),
    longitude: z.number().gte(-180).lte(180).nullable(),
    accuracy: z.number().nonnegative().nullable(),
    speed: z.number().min(-1).max(200).nullable(),
    heading: z.number().min(0).max(360).nullable(),
    batteryLevel: z.number().min(0).max(100).nullable(),
    charging: z.boolean(),
    networkType: z.enum(NETWORK_TYPES),
    deviceOnline: z.boolean(),
    evidenceStatus: z.enum(["NONE", "RECORDING", "UPLOADING", "STORED"]),
    permissionsStatus: z.string().trim().min(1).max(80),
    batteryMode: z.enum(["NORMAL", "REDUCED", "SURVIVAL", "CRITICAL_ONLY"]),
  })
  .strict()
  .superRefine(requireCoordinatePair);

export const guardianSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    phone: z.string().trim().max(20).optional(),
    email: z.string().trim().email().max(254).optional(),
    canViewLocation: z.boolean().optional(),
    canViewEvidence: z.boolean().optional(),
  })
  .strict();

export const journeySchema = z
  .object({
    destinationLabel: z.string().trim().min(1).max(120),
    expectedArrivalAt: isoTime,
    checkInIntervalSeconds: z.number().int().min(60).max(6 * 60 * 60),
  })
  .strict();

export const safetyPinSchema = z
  .object({
    cancelPin: z.string().regex(/^[0-9]{4,8}$/),
    duressPin: z.string().regex(/^[0-9]{4,8}$/),
  })
  .strict()
  .refine((value) => value.cancelPin !== value.duressPin, { message: "The duress PIN must be different from the cancel PIN." });

export const cancelIncidentSchema = z
  .object({
    pin: z.string().regex(/^[0-9]{4,8}$/),
  })
  .strict();

export const evidenceChunkSchema = z
  .object({
    clientChunkId: z.string().uuid(),
    sequence: z.number().int().min(0).max(100000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentType: z.enum(["audio/pcm", "image/jpeg"]),
    bytesBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(4).max(280000),
  })
  .strict();

export const operatorActionSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export function isDeliberateTrigger(triggerType: string): boolean {
  return (DELIBERATE_TRIGGER_TYPES as readonly string[]).includes(triggerType);
}

export function distressCapsuleByteLength(capsule: unknown): number {
  return Buffer.byteLength(JSON.stringify(capsule), "utf8");
}

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DeviceRegistrationInput = z.infer<typeof deviceRegistrationSchema>;
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type LocationBatchInput = z.infer<typeof locationBatchSchema>;
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
export type OperatorActionInput = z.infer<typeof operatorActionSchema>;
export type GuardianInput = z.infer<typeof guardianSchema>;
export type JourneyInput = z.infer<typeof journeySchema>;
export type SafetyPinInput = z.infer<typeof safetyPinSchema>;
export type CancelIncidentInput = z.infer<typeof cancelIncidentSchema>;
export type EvidenceChunkInput = z.infer<typeof evidenceChunkSchema>;
