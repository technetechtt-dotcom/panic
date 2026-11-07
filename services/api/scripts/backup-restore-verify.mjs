import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dump = process.argv[2];
if (!dump) {
  console.error("Usage: node backup-restore-verify.mjs <dump.sql>");
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), "guardian-restore-"));
let restoreFile = dump;
if (dump.endsWith(".enc")) {
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key) {
    console.error("BACKUP_ENCRYPTION_KEY is required to verify an encrypted backup.");
    process.exit(1);
  }
  restoreFile = join(work, "guardian-restore.sql");
  const decrypt = spawnSync(
    "openssl",
    ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", dump, "-out", restoreFile, "-pass", "env:BACKUP_ENCRYPTION_KEY"],
    { stdio: "inherit", env: process.env },
  );
  if (decrypt.status !== 0) {
    console.error("Backup decryption failed.");
    process.exit(decrypt.status ?? 1);
  }
}
const text = readFileSync(restoreFile, "utf8");
if (!text.includes("PostgreSQL database dump")) {
  console.error("Not a PostgreSQL dump after decryption.");
  process.exit(1);
}

const verifyUrl = process.env.BACKUP_VERIFY_DATABASE_URL;
if (!verifyUrl) {
  console.error("BACKUP_VERIFY_DATABASE_URL is required (a throwaway database, never production).");
  process.exit(1);
}
if (process.env.DATABASE_URL && verifyUrl === process.env.DATABASE_URL) {
  console.error("Refusing to restore-verify into DATABASE_URL. Use a separate throwaway database.");
  process.exit(1);
}

try {
  const drop = spawnSync(
    "psql",
    ["--dbname", verifyUrl, "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"],
    { stdio: "inherit" },
  );
  if (drop.status !== 0) process.exit(drop.status ?? 1);
  const restore = spawnSync("psql", ["--dbname", verifyUrl, "--file", restoreFile, "-v", "ON_ERROR_STOP=1"], { stdio: "inherit" });
  if (restore.status !== 0) process.exit(restore.status ?? 1);
  const check = spawnSync(
    "psql",
    ["--dbname", verifyUrl, "-v", "ON_ERROR_STOP=1", "-tAc", "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"],
    { encoding: "utf8" },
  );
  if (check.status !== 0) process.exit(check.status ?? 1);
  const tables = Number((check.stdout || "").trim());
  if (!Number.isFinite(tables) || tables < 1) {
    console.error("Restore verification found no public tables.");
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, tables, dump, encrypted: dump.endsWith(".enc"), verifiedAt: new Date().toISOString() }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
