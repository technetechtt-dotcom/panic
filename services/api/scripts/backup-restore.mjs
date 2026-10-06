import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
mkdirSync("data/backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = `data/backups/guardian-${stamp}.sql`;
const dump = spawnSync("pg_dump", ["--dbname", url, "--format", "plain", "--file", file], { stdio: "inherit" });
if (dump.status !== 0) {
  console.error("pg_dump is not available or the database refused the backup.");
  process.exit(dump.status ?? 1);
}
const text = readFileSync(file, "utf8");
if (!text.includes("PostgreSQL database dump")) {
  console.error("The backup file does not look like a PostgreSQL dump.");
  process.exit(1);
}
writeFileSync(`${file}.ok`, "dump file contains a PostgreSQL header\n");
console.log(file);
