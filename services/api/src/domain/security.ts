import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual, verify } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@guardian/shared-types";

function scryptAsync(
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString("base64url")}`;
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    const parts = passwordHash.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = parts[4];
    const expected = Buffer.from(parts[5], "base64url");
    if (!Number.isFinite(n) || !salt || expected.length === 0) return false;
    const derived = await scryptAsync(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sealSecret(value: string, keyMaterial: string): string {
  const key = scryptSync(keyMaterial, "guardian-mfa-at-rest", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${Buffer.concat([iv, tag, body]).toString("base64url")}`;
}

export function openSecret(value: string, keyMaterial: string): string {
  if (!value.startsWith("enc:v1:")) return value;
  const raw = Buffer.from(value.slice("enc:v1:".length), "base64url");
  if (raw.length < 29) throw new Error("Invalid encrypted secret.");
  const key = scryptSync(keyMaterial, "guardian-mfa-at-rest", 32);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export function deviceProofMessage(triggerId: string, devicePublicId: string, signedAt: string): string {
  return `${triggerId}|${devicePublicId}|${signedAt}`;
}

export function verifyDeviceProof(publicKeySpkiBase64: string, signatureBase64: string, message: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
    return verify("sha256", Buffer.from(message, "utf8"), key, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

export interface AccessClaims {
  sub: string;
  role: Role;
}

export class JwtAccessTokens {
  private readonly secret: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    if (secret.length < 32) {
      throw new Error("JWT_ACCESS_SECRET must be at least 32 characters.");
    }
    this.secret = new TextEncoder().encode(secret);
  }

  async sign(user: { id: string; role: Role }): Promise<string> {
    return new SignJWT({ role: user.role, typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.secret);
  }

  async verify(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.secret, { algorithms: ["HS256"] });
    if (payload.typ !== "access" || typeof payload.sub !== "string") {
      throw new Error("Invalid access token");
    }
    if (typeof payload.role !== "string") throw new Error("Invalid access token");
    return { sub: payload.sub, role: payload.role as Role };
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "refreshtoken",
  "accesstoken",
  "authorization",
  "pin",
  "jwt",
  "secret",
]);

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(child);
    }
    return output;
  }
  return value;
}
