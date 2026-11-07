import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const localDir = process.env.BACKUP_LOCAL_DIR || "data/backups";
mkdirSync(localDir, { recursive: true });
const file = join(localDir, `guardian-${stamp}.sql`);
const dump = spawnSync("pg_dump", ["--dbname", url, "--format", "plain", "--file", file], { stdio: "inherit" });
if (dump.status !== 0) {
  console.error("pg_dump failed.");
  process.exit(dump.status ?? 1);
}
const bytes = readFileSync(file);
if (!bytes.toString("utf8").includes("PostgreSQL database dump")) {
  console.error("Dump header missing.");
  process.exit(1);
}
const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();
if (!encryptionKey) {
  console.error("BACKUP_ENCRYPTION_KEY is required for off-host production backups.");
  process.exit(1);
}
const encryptedFile = `${file}.enc`;
const encrypt = spawnSync(
  "openssl",
  ["enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "200000", "-in", file, "-out", encryptedFile, "-pass", "env:BACKUP_ENCRYPTION_KEY"],
  { stdio: "inherit", env: process.env },
);
if (encrypt.status !== 0) {
  console.error("Backup encryption failed.");
  process.exit(encrypt.status ?? 1);
}
unlinkSync(file);
const encryptedBytes = readFileSync(encryptedFile);
const sha = createHash("sha256").update(encryptedBytes).digest("hex");
writeFileSync(`${encryptedFile}.sha256`, `${sha}  ${basename(encryptedFile)}\n`);

const bucket = process.env.BACKUP_S3_BUCKET?.trim();
const endpoint = process.env.BACKUP_S3_ENDPOINT?.trim();
const region = process.env.BACKUP_S3_REGION?.trim() || "auto";
const keyId = process.env.BACKUP_S3_ACCESS_KEY_ID?.trim();
const secret = process.env.BACKUP_S3_SECRET_ACCESS_KEY?.trim();
const prefix = (process.env.BACKUP_S3_PREFIX?.trim() || "guardian/db").replace(/\/$/, "");

if (!bucket || !keyId || !secret) {
  console.log(JSON.stringify({ local: file, sha256: sha, offHost: false, reason: "BACKUP_S3_* not fully configured" }));
  process.exit(0);
}

const objectKey = `${prefix}/${basename(encryptedFile)}`;
const aws = spawnSync(
  "aws",
  [
    "s3",
    "cp",
    encryptedFile,
    `s3://${bucket}/${objectKey}`,
    ...(endpoint ? ["--endpoint-url", endpoint] : []),
    "--region",
    region,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: keyId,
      AWS_SECRET_ACCESS_KEY: secret,
      AWS_DEFAULT_REGION: region,
    },
  },
);
if (aws.status !== 0) {
  console.error("Off-host upload failed. Encrypted local dump kept.");
  process.exit(aws.status ?? 1);
}

const meta = {
  local: encryptedFile,
  sha256: sha,
  offHost: true,
  bucket,
  objectKey,
  uploadedAt: new Date().toISOString(),
};
writeFileSync(`${encryptedFile}.offhost.json`, `${JSON.stringify(meta, null, 2)}\n`);
process.env.LAST_BACKUP_AT = meta.uploadedAt;
console.log(JSON.stringify(meta));
