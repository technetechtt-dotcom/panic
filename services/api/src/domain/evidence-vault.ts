import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredObject {
  storageKey: string;
  byteLength: number;
  duplicatedToS3: boolean;
  s3Detail: string;
}

export class FileEvidenceVault {
  constructor(
    private readonly directory: string,
    private readonly keyMaterial: string,
  ) {}

  async put(storageKey: string, plain: Buffer): Promise<StoredObject> {
    await mkdir(this.directory, { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const sealed = Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    await writeFile(path.join(this.directory, `${storageKey}.bin`), sealed);
    const s3 = await putObjectIfConfigured(storageKey, sealed);
    return { storageKey, byteLength: plain.length, duplicatedToS3: s3.stored, s3Detail: s3.detail };
  }

  async get(storageKey: string): Promise<Buffer | null> {
    const sealed = await readFile(path.join(this.directory, `${storageKey}.bin`)).catch(() => null);
    if (!sealed || sealed.length < 29) return null;
    const iv = sealed.subarray(0, 12);
    const tag = sealed.subarray(sealed.length - 16);
    const data = sealed.subarray(12, sealed.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  private key(): Buffer {
    return scryptSync(this.keyMaterial, "guardian-evidence", 32);
  }
}

export function s3Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.S3_BUCKET?.trim() && env.S3_ENDPOINT?.trim() && env.S3_ACCESS_KEY_ID?.trim() && env.S3_SECRET_ACCESS_KEY?.trim());
}

export async function putObjectIfConfigured(storageKey: string, body: Buffer, env: NodeJS.ProcessEnv = process.env): Promise<{ stored: boolean; detail: string }> {
  if (!s3Configured(env)) {
    return { stored: false, detail: "Object storage is not configured. The encrypted file remains on this API host." };
  }
  const bucket = env.S3_BUCKET!.trim();
  const endpoint = new URL(env.S3_ENDPOINT!.trim());
  const region = env.S3_REGION?.trim() || "us-east-1";
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalUri = `/${bucket}/${storageKey}.bin`;
  const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.S3_SECRET_ACCESS_KEY!.trim()}`, date), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.S3_ACCESS_KEY_ID!.trim()}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`${endpoint.origin}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Host: endpoint.host,
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      "Content-Length": String(body.length),
    },
    body: new Uint8Array(body),
  }).catch(() => null);
  if (response?.ok) return { stored: true, detail: "Copied to the configured S3 bucket." };
  return { stored: false, detail: "S3 did not accept the object. The encrypted file remains on this API host." };
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}
