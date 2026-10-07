import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const mode = process.argv[2] ?? "backup";
if (mode === "restore") {
  const file = process.argv[3];
  if (!file) {
    console.error("Usage: node backup-restore.mjs restore <dump.sql>");
    process.exit(1);
  }
  const text = readFileSync(file, "utf8");
  if (!text.includes("PostgreSQL database dump")) {
    console.error("That file does not look like a PostgreSQL dump.");
    process.exit(1);
  }
  const restore = spawnSync("psql", ["--dbname", url, "--file", file], { stdio: "inherit" });
  process.exit(restore.status ?? 1);
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
