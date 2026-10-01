import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(import.meta.dirname, "../../..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const user = env.POSTGRES_USER || "guardian";
const password = env.POSTGRES_PASSWORD ?? "";
const database = env.POSTGRES_DB || "guardian";
if (password.length < 8) {
  console.error("Set POSTGRES_PASSWORD in .env before starting local PostgreSQL.");
  process.exit(1);
}

const databaseDir = path.join(root, "infrastructure", "docker", "data", "pg");
const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port: 5432,
  persistent: true,
  onLog: (message) => process.stdout.write(message),
});

if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
  await pg.initialise();
}
await pg.start();

const client = await connectMaintenance(pg, user);
const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
if (existing.rowCount === 0) {
  await client.query(`CREATE DATABASE ${client.escapeIdentifier(database)}`);
}
await client.end();
console.log(JSON.stringify({ level: "info", message: "local postgres ready", port: 5432, database }));
await new Promise(() => {});

async function connectMaintenance(pg, user) {
  let lastError = new Error("Could not connect to the local PostgreSQL cluster.");
  for (const name of ["postgres", "template1", user]) {
    const client = pg.getPgClient(name);
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
      await client.end().catch(() => undefined);
    }
  }
  throw lastError;
}
