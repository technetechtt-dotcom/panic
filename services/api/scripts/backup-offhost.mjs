import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
const sha = createHash("sha256").update(bytes).digest("hex");
writeFileSync(`${file}.sha256`, `${sha}  ${basename(file)}\n`);

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

const objectKey = `${prefix}/${basename(file)}`;
const aws = spawnSync(
  "aws",
  [
    "s3",
    "cp",
    file,
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
  console.error("Off-host upload failed. Local dump kept.");
  process.exit(aws.status ?? 1);
}

const meta = {
  local: file,
  sha256: sha,
  offHost: true,
  bucket,
  objectKey,
  uploadedAt: new Date().toISOString(),
};
writeFileSync(`${file}.offhost.json`, `${JSON.stringify(meta, null, 2)}\n`);
process.env.LAST_BACKUP_AT = meta.uploadedAt;
console.log(JSON.stringify(meta));
