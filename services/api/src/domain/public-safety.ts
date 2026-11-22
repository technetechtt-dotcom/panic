import { createHmac, timingSafeEqual } from "node:crypto";
import type { PublicSafetyService } from "@guardian/shared-types";

export interface PublicSafetyRequest {
  incidentId: string;
  correlationId: string;
  service: PublicSafetyService;
  name: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  duress: boolean;
  note: string | null;
  medical: { bloodType: string | null; allergies: string | null; medications: string | null };
}

export interface PublicSafetyResult {
  service: PublicSafetyService;
  status: "DISPATCHED" | "FAILED" | "NOT_CONFIGURED";
  provider: "NOONLIGHT" | "BRIDGE" | "UNCONFIGURED";
  reference: string | null;
  detail: string;
  dial: string;
}

interface DispatchTarget {
  provider: "NOONLIGHT" | "BRIDGE";
  url: string;
  token: string;
}

export function publicSafetyDial(env: NodeJS.ProcessEnv = process.env): string {
  const dial = env.PUBLIC_SAFETY_DIAL?.trim();
  return dial && /^\d{3,4}$/.test(dial) ? dial : "112";
}

export function publicSafetyTarget(env: NodeJS.ProcessEnv = process.env): DispatchTarget | null {
  const noonlightUrl = env.NOONLIGHT_API_URL?.trim() ?? "";
  const noonlightToken = env.NOONLIGHT_API_TOKEN?.trim() ?? "";
  if (noonlightUrl && noonlightToken) return { provider: "NOONLIGHT", url: join(noonlightUrl, "/dispatch/v1/alarms"), token: noonlightToken };
  const bridgeUrl = env.PUBLIC_SAFETY_URL?.trim() ?? "";
  const bridgeToken = env.PUBLIC_SAFETY_TOKEN?.trim() ?? "";
  if (bridgeUrl && bridgeToken) return { provider: "BRIDGE", url: bridgeUrl, token: bridgeToken };
  return null;
}

export function publicSafetyHealth(env: NodeJS.ProcessEnv = process.env): "NOONLIGHT" | "BRIDGE" | "NOT_CONFIGURED" {
  return publicSafetyTarget(env)?.provider ?? "NOT_CONFIGURED";
}

export function iridiumHealth(env: NodeJS.ProcessEnv = process.env): "CONFIGURED" | "NOT_CONFIGURED" {
  return (env.IRIDIUM_WEBHOOK_SECRET?.trim().length ?? 0) >= 16 ? "CONFIGURED" : "NOT_CONFIGURED";
}

export function narrowbandMac(secret: Buffer, canonical: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex").slice(0, 16);
}

export function macMatches(expectedHex: string, actualHex: string): boolean {
  if (!/^[0-9a-f]{16}$/.test(expectedHex) || !/^[0-9a-f]{16}$/.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function dispatchPublicSafety(
  request: PublicSafetyRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicSafetyResult> {
  const dial = publicSafetyDial(env);
  const target = publicSafetyTarget(env);
  if (!target) {
    return {
      service: request.service,
      status: "NOT_CONFIGURED",
      provider: "UNCONFIGURED",
      reference: null,
      detail: `No public-safety provider is configured. The operator can call ${dial}. Guardian did not place that call.`,
      dial,
    };
  }
  if (request.latitude === null || request.longitude === null) {
    return failed(request, target.provider, dial, "Public safety dispatch needs a confirmed latitude and longitude.");
  }
  if (target.provider === "NOONLIGHT" && !request.phone) {
    return failed(request, target.provider, dial, "Noonlight needs a callback phone on the person's profile.");
  }
  const body = target.provider === "NOONLIGHT" ? noonlightBody(request) : bridgeBody(request);
  try {
    const response = await fetchImpl(target.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => null)) as { id?: unknown; alarm_id?: unknown; reference?: unknown; detail?: unknown } | null;
    if (!response.ok) {
      const detail = typeof payload?.detail === "string" ? payload.detail : `The ${target.provider.toLowerCase()} dispatch returned HTTP ${response.status}.`;
      return failed(request, target.provider, dial, detail);
    }
    const reference = stringField(payload?.id) ?? stringField(payload?.alarm_id) ?? stringField(payload?.reference);
    return {
      service: request.service,
      status: "DISPATCHED",
      provider: target.provider,
      reference,
      detail: reference
        ? `${request.service} was accepted by ${target.provider}. Reference ${reference}.`
        : `${request.service} was accepted by ${target.provider}.`,
      dial,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The public-safety provider could not be reached.";
    return failed(request, target.provider, dial, detail);
  }
}

function failed(
  request: PublicSafetyRequest,
  provider: "NOONLIGHT" | "BRIDGE",
  dial: string,
  detail: string,
): PublicSafetyResult {
  return { service: request.service, status: "FAILED", provider, reference: null, detail, dial };
}

export function noonlightBody(request: PublicSafetyRequest): Record<string, unknown> {
  return {
    name: request.name,
    phone: digits(request.phone),
    location: {
      coordinates: {
        lat: request.latitude,
        lng: request.longitude,
        accuracy: request.accuracy ?? 0,
      },
    },
    services: {
      police: request.service === "POLICE",
      fire: request.service === "FIRE",
      medical: request.service === "EMS",
    },
    meta: {
      incident_id: request.incidentId,
      correlation_id: request.correlationId,
      duress: request.duress,
      note: request.note,
      blood_type: request.medical.bloodType,
      allergies: request.medical.allergies,
      medications: request.medical.medications,
    },
  };
}

function bridgeBody(request: PublicSafetyRequest): Record<string, unknown> {
  return {
    incidentId: request.incidentId,
    correlationId: request.correlationId,
    service: request.service,
    name: request.name,
    phone: request.phone,
    latitude: request.latitude,
    longitude: request.longitude,
    accuracy: request.accuracy,
    duress: request.duress,
    note: request.note,
    medical: request.medical,
  };
}

function digits(phone: string | null): string {
  return (phone ?? "").replace(/\D/g, "");
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function join(base: string, suffix: string): string {
  return `${base.replace(/\/$/, "")}${suffix}`;
}
