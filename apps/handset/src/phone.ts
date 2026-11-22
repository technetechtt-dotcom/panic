import { canonicalNarrowband, ecdsaP1363ToDer, formatNarrowband, type NarrowbandFields } from "@guardian/handset-wire";

const VAULT_KEY = "guardian.handset";

export interface Vault {
  devicePublicId: string;
  deviceId: string;
  jwk: JsonWebKey;
  credential: string;
}

export interface SosResult {
  incidentId: string;
  path: "DATA" | "SMS" | "SATELLITE_READY";
  message?: string;
}

interface SessionBody {
  accessToken?: string;
  mfaRequired?: boolean;
  mfaEnrollmentRequired?: boolean;
}

export function loadVault(): Vault | null {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Vault;
    if (!parsed.deviceId || !parsed.credential || !parsed.jwk) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function smsHref(message: string): string {
  const gateway = import.meta.env.VITE_GUARDIAN_SMS_GATEWAY?.trim() ?? "";
  return `sms:${encodeURIComponent(gateway)}?body=${encodeURIComponent(message)}`;
}

export async function authenticate(path: "/api/v1/auth/login" | "/api/v1/auth/register", body: unknown): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: SessionBody; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Sign-in failed.");
  if (payload.data?.mfaRequired || payload.data?.mfaEnrollmentRequired) {
    throw new Error("This account uses the monitoring desk. The phone app is for the person being protected.");
  }
  if (!payload.data?.accessToken) throw new Error("Sign-in did not return a session.");
  return payload.data.accessToken;
}

export async function ensureDevice(token: string): Promise<{ vault: Vault; privateKey: CryptoKey }> {
  const existing = loadVault();
  if (existing) {
    const privateKey = await crypto.subtle.importKey("jwk", existing.jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    return { vault: existing, privateKey };
  }
  const devicePublicId = crypto.randomUUID();
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const registered = await api<{ id: string }>("/api/v1/devices", token, {
    method: "POST",
    body: JSON.stringify({
      devicePublicId,
      platform: "WEB",
      manufacturer: navigator.vendor || "browser",
      model: "Guardian handset",
      osVersion: navigator.platform || "web",
      appVersion: "0.1.0",
      publicKey: bytesBase64(spki),
    }),
  });
  const issued = await api<{ credential: string }>("/api/v1/devices/emergency-credential", token, {
    method: "POST",
    body: JSON.stringify({ deviceId: registered.id }),
  });
  const vault: Vault = {
    devicePublicId,
    deviceId: registered.id,
    jwk,
    credential: issued.credential,
  };
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  return { vault, privateKey: pair.privateKey };
}

export async function bindImei(token: string, deviceId: string, imei: string): Promise<void> {
  await api("/api/v1/devices/iridium", token, {
    method: "POST",
    body: JSON.stringify({ deviceId, imei }),
  });
}

export async function raiseSos(token: string, vault: Vault, privateKey: CryptoKey): Promise<SosResult> {
  const triggerId = crypto.randomUUID();
  const signedAt = new Date().toISOString();
  const position = await currentPosition();
  const battery = await currentBattery();
  const capsule = {
    timestamp: signedAt,
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
    locationAccuracy: position?.accuracy ?? null,
    speed: position?.speed ?? null,
    heading: position?.heading ?? null,
    batteryLevel: battery.level,
    chargingStatus: battery.charging,
    networkType: navigator.onLine ? "CELLULAR" : "NO_INTERNET",
    protectionMode: "HIGH_RISK",
    duress: false,
    lastKnownLocation: null,
    appProtectionStatus: "PROTECTED",
  };
  const signature = await signProof(privateKey, `${triggerId}|${vault.devicePublicId}|${signedAt}`);
  const body = {
    triggerId,
    triggerType: "MANUAL_SOS",
    correlationId: crypto.randomUUID(),
    deviceId: vault.deviceId,
    isTest: false,
    deviceProof: { algorithm: "SHA256withECDSA", signature, signedAt },
    distressCapsule: capsule,
  };
  try {
    const incident = await api<{ id: string }>("/api/v1/incidents", token, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    return { incidentId: incident.id, path: "DATA" };
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    const message = await narrowbandMessage(vault, {
      devicePublicId: vault.devicePublicId,
      triggerId,
      triggerType: "MANUAL_SOS",
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      accuracyMeters: position?.accuracy ?? null,
      batteryPercent: battery.level,
      duress: false,
      charging: battery.charging,
      isTest: false,
      lastKnown: false,
      unixSeconds: Math.floor(Date.now() / 1000),
    });
    return { incidentId: "", path: "SMS", message };
  }
}

export async function uploadPhoto(token: string, incidentId: string, file: File): Promise<void> {
  const bytes = await jpegBytes(file);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bufferSource(bytes)));
  await api(`/api/v1/incidents/${incidentId}/evidence`, token, {
    method: "POST",
    body: JSON.stringify({
      clientChunkId: crypto.randomUUID(),
      sequence: 0,
      sha256: hex(digest),
      contentType: "image/jpeg",
      bytesBase64: bytesBase64(bytes),
    }),
  });
}

async function narrowbandMessage(vault: Vault, fields: NarrowbandFields): Promise<string> {
  const canonical = canonicalNarrowband(fields);
  const mac = await hmacHex(vault.credential, canonical);
  return formatNarrowband(canonical, mac);
}

async function hmacHex(credential: string, canonical: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    bufferSource(base64UrlBytes(credential)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)));
  return hex(signature.slice(0, 8));
}

async function signProof(privateKey: CryptoKey, message: string): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(message)));
  return bytesBase64(ecdsaP1363ToDer(raw));
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new ApiFailure(payload.error?.message ?? "The request was rejected.");
  return payload.data as T;
}

class ApiFailure extends Error {}

function currentPosition(): Promise<{ latitude: number; longitude: number; accuracy: number | null; speed: number | null; heading: number | null } | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        speed: position.coords.speed,
        heading: position.coords.heading,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 15_000 },
    );
  });
}

async function currentBattery(): Promise<{ level: number | null; charging: boolean }> {
  const batteryApi = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
  if (!batteryApi.getBattery) return { level: null, charging: false };
  try {
    const battery = await batteryApi.getBattery();
    return { level: Math.round(battery.level * 100), charging: battery.charging };
  } catch {
    return { level: null, charging: false };
  }
}

async function jpegBytes(file: File): Promise<Uint8Array> {
  if (file.type === "image/jpeg" && file.size > 0 && file.size <= 900_000) return new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This phone could not prepare the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Photo encoding failed."))), "image/jpeg", 0.72);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function bytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64UrlBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
